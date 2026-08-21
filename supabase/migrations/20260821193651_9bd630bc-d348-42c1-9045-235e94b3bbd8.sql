CREATE POLICY "room_players_update_host" ON public.room_players
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_players.room_id AND r.host_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_players.room_id AND r.host_id = auth.uid()));

ALTER TABLE public.room_players REPLICA IDENTITY FULL;
ALTER TABLE public.game_rounds REPLICA IDENTITY FULL;
ALTER TABLE public.game_winners REPLICA IDENTITY FULL;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;