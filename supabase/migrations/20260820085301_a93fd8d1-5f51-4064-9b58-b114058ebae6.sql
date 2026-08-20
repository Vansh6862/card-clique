-- =========================================================
-- Reusable updated_at trigger function
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- 1. Wallets (player chip balance across tables)
-- =========================================================
CREATE TABLE public.wallets (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  balance integer NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  total_deposited integer NOT NULL DEFAULT 0 CHECK (total_deposited >= 0),
  total_wagered integer NOT NULL DEFAULT 0 CHECK (total_wagered >= 0),
  total_won integer NOT NULL DEFAULT 0 CHECK (total_won >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets_select_own"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "wallets_insert_own"
  ON public.wallets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallets_update_own"
  ON public.wallets FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 2. Game rounds
-- =========================================================
CREATE TABLE public.game_rounds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','dealing','active','showdown','finished')),
  pot integer NOT NULL DEFAULT 0 CHECK (pot >= 0),
  boot_amount integer NOT NULL DEFAULT 10 CHECK (boot_amount >= 0),
  current_turn_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dealer_seat integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round_number)
);

GRANT SELECT, INSERT, UPDATE ON public.game_rounds TO authenticated;
GRANT ALL ON public.game_rounds TO service_role;

ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_rounds_select_room_member"
  ON public.game_rounds FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.room_players rp
      WHERE rp.room_id = game_rounds.room_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "game_rounds_insert_host"
  ON public.game_rounds FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = game_rounds.room_id AND r.host_id = auth.uid()
    )
  );

CREATE POLICY "game_rounds_update_host"
  ON public.game_rounds FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = game_rounds.room_id AND r.host_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = game_rounds.room_id AND r.host_id = auth.uid()
    )
  );

CREATE TRIGGER update_game_rounds_updated_at
  BEFORE UPDATE ON public.game_rounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 3. Game hands (public per-player state in a round)
-- =========================================================
CREATE TABLE public.game_hands (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seat integer,
  is_blind boolean NOT NULL DEFAULT true,
  is_folded boolean NOT NULL DEFAULT false,
  is_seen boolean NOT NULL DEFAULT false,
  current_bet integer NOT NULL DEFAULT 0 CHECK (current_bet >= 0),
  total_bet integer NOT NULL DEFAULT 0 CHECK (total_bet >= 0),
  last_action text CHECK (last_action IN ('deal','see','bet','chaal','fold','show','pack','blind_bet')),
  action_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.game_hands TO authenticated;
GRANT ALL ON public.game_hands TO service_role;

ALTER TABLE public.game_hands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_hands_select_room_member"
  ON public.game_hands FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.room_players rp ON rp.room_id = gr.room_id
      WHERE gr.id = game_hands.round_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "game_hands_insert_own"
  ON public.game_hands FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.room_players rp ON rp.room_id = gr.room_id
      WHERE gr.id = game_hands.round_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "game_hands_update_own"
  ON public.game_hands FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_game_hands_updated_at
  BEFORE UPDATE ON public.game_hands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 4. Game hand cards (PRIVATE — owner + server only)
-- =========================================================
CREATE TABLE public.game_hand_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cards jsonb NOT NULL, -- array of 3 cards: [{"suit":"spades","rank":"A"}, ...]
  revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.game_hand_cards TO authenticated;
GRANT ALL ON public.game_hand_cards TO service_role;

ALTER TABLE public.game_hand_cards ENABLE ROW LEVEL SECURITY;

-- Only the owner can ever read their own cards; nobody else sees them.
CREATE POLICY "game_hand_cards_select_own"
  ON public.game_hand_cards FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "game_hand_cards_insert_own"
  ON public.game_hand_cards FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "game_hand_cards_update_own"
  ON public.game_hand_cards FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_game_hand_cards_updated_at
  BEFORE UPDATE ON public.game_hand_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 5. Game actions (move log)
-- =========================================================
CREATE TABLE public.game_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('deal','see','bet','chaal','fold','show','pack','blind_bet')),
  amount integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_blind_action boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.game_actions TO authenticated;
GRANT ALL ON public.game_actions TO service_role;

ALTER TABLE public.game_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_actions_select_room_member"
  ON public.game_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.room_players rp ON rp.room_id = gr.room_id
      WHERE gr.id = game_actions.round_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "game_actions_insert_own"
  ON public.game_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.room_players rp ON rp.room_id = gr.room_id
      WHERE gr.id = game_actions.round_id AND rp.user_id = auth.uid()
    )
  );

-- =========================================================
-- 6. Game winners (round results)
-- =========================================================
CREATE TABLE public.game_winners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount >= 0),
  hand_rank text,
  cards jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);

GRANT SELECT, INSERT ON public.game_winners TO authenticated;
GRANT ALL ON public.game_winners TO service_role;

ALTER TABLE public.game_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_winners_select_room_member"
  ON public.game_winners FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.room_players rp ON rp.room_id = gr.room_id
      WHERE gr.id = game_winners.round_id AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "game_winners_insert_host"
  ON public.game_winners FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.game_rounds gr
      JOIN public.rooms r ON r.id = gr.room_id
      WHERE gr.id = game_winners.round_id AND r.host_id = auth.uid()
    )
  );

-- =========================================================
-- 7. Transactions (chip movement ledger) — after game_rounds
-- =========================================================
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('deposit','withdrawal','bet','win','loss','boot','bonus','transfer')),
  amount integer NOT NULL, -- signed: positive credits, negative debits
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  round_id uuid REFERENCES public.game_rounds(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_select_own"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "transactions_insert_own"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- Realtime: publish the new gameplay tables
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_hands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_winners;