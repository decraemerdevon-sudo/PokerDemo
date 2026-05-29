CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hands (
  hand_id            TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  hand_number        INTEGER NOT NULL,
  timestamp          BIGINT NOT NULL,
  button_seat_index  INTEGER NOT NULL,
  flop_cards         JSONB,
  turn_card          JSONB,
  river_card         JSONB,
  saw_flop           TEXT[] NOT NULL DEFAULT '{}',
  went_to_showdown   TEXT[] NOT NULL DEFAULT '{}',
  voluntary_put_in_pot TEXT[] NOT NULL DEFAULT '{}',
  players            JSONB NOT NULL,
  streets            JSONB NOT NULL,
  pots               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hands_session_id_idx ON hands(session_id);
CREATE INDEX IF NOT EXISTS hands_timestamp_idx  ON hands(timestamp DESC);
