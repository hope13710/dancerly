-- Sketch feedback: a note can carry a drawing on the frame (pen, arrow, circle).
-- Stored as vectors normalized to the video picture (0–1), so it lines up on any screen and in mirror mode:
-- { "v": 1, "strokes": [ { "tool": "pen" | "arrow" | "circle", "color": "#ffd60a", "w": 0.006, "pts": [[x, y], ...] } ] }
-- It shows over the video at the note's moment (or across its range). Visibility follows the note, private ones included.
alter table public.notes add column sketch jsonb
  constraint notes_sketch_shape check (
    sketch is null or (
      jsonb_typeof(sketch) = 'object'
      and jsonb_typeof(sketch -> 'strokes') = 'array'
      and jsonb_array_length(sketch -> 'strokes') between 1 and 200
      and pg_column_size(sketch) <= 200000
    )
  );
