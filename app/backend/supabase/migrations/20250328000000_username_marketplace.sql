CREATE TABLE username_marketplace (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  username          TEXT          NOT NULL REFERENCES usernames(username) ON DELETE CASCADE,
  seller_public_key TEXT          NOT NULL,
  asking_price      NUMERIC(20,7) NOT NULL CHECK (asking_price > 0),
  status            TEXT          NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  sold_at           TIMESTAMPTZ,
  buyer_public_key  TEXT,
  final_price       NUMERIC(20,7),
  payment_tx_hash   TEXT
);

CREATE UNIQUE INDEX username_marketplace_active_unique
  ON username_marketplace (username)
  WHERE status = 'active';

CREATE UNIQUE INDEX username_marketplace_payment_tx_unique
  ON username_marketplace (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL AND status = 'sold';

CREATE INDEX username_marketplace_seller_idx   ON username_marketplace (seller_public_key);
CREATE INDEX username_marketplace_status_idx   ON username_marketplace (status);
CREATE INDEX username_marketplace_username_idx ON username_marketplace (username);

CREATE TABLE username_bids (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          UUID          NOT NULL REFERENCES username_marketplace(id) ON DELETE CASCADE,
  bidder_public_key   TEXT          NOT NULL,
  bid_amount          NUMERIC(20,7) NOT NULL CHECK (bid_amount > 0),
  status              TEXT          NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  payment_tx_hash     TEXT,
  payment_verified_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX username_bids_listing_idx ON username_bids (listing_id);
CREATE INDEX username_bids_bidder_idx  ON username_bids (bidder_public_key);
CREATE INDEX username_bids_status_idx  ON username_bids (status);

CREATE UNIQUE INDEX username_bids_accepted_payment_tx_unique
  ON username_bids (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL AND status = 'accepted';

CREATE OR REPLACE FUNCTION accept_username_bid(
  p_listing_id         UUID,
  p_bid_id             UUID,
  p_seller_public_key  TEXT,
  p_payment_tx_hash    TEXT DEFAULT NULL,
  p_verified_amount    NUMERIC(20,7) DEFAULT NULL,
  p_verified_payer     TEXT DEFAULT NULL,
  p_verified_recipient TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_listing            username_marketplace%ROWTYPE;
  v_bid                username_bids%ROWTYPE;
  v_normalized_tx_hash TEXT;
BEGIN
  v_normalized_tx_hash := lower(btrim(coalesce(p_payment_tx_hash, '')));

  IF v_normalized_tx_hash = '' OR v_normalized_tx_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: A valid 64-character Stellar transaction hash is required to accept a bid';
  END IF;

  IF p_verified_amount IS NULL OR p_verified_payer IS NULL OR p_verified_recipient IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_NOT_VERIFIED: On-chain payment verification proof is required before transferring username ownership';
  END IF;

  SELECT * INTO v_listing
    FROM username_marketplace
   WHERE id = p_listing_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LISTING_NOT_FOUND: Listing % does not exist', p_listing_id;
  END IF;

  IF v_listing.status != 'active' THEN
    RAISE EXCEPTION 'LISTING_NOT_ACTIVE: Listing is in status "%"', v_listing.status;
  END IF;

  IF v_listing.seller_public_key != p_seller_public_key THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Caller is not the seller of this listing';
  END IF;

  SELECT * INTO v_bid
    FROM username_bids
   WHERE id = p_bid_id
     AND listing_id = p_listing_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BID_NOT_FOUND: Bid % does not exist on this listing', p_bid_id;
  END IF;

  IF v_bid.status != 'pending' THEN
    RAISE EXCEPTION 'BID_NOT_PENDING: Bid is in status "%"', v_bid.status;
  END IF;

  IF p_verified_payer != v_bid.bidder_public_key THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH: Verified payment sender (%) does not match bidder (%)', p_verified_payer, v_bid.bidder_public_key;
  END IF;

  IF p_verified_recipient != v_listing.seller_public_key THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH: Verified payment recipient (%) does not match seller (%)', p_verified_recipient, v_listing.seller_public_key;
  END IF;

  IF p_verified_amount < v_bid.bid_amount THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH: Verified payment amount (%) is less than bid amount (%)', p_verified_amount, v_bid.bid_amount;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM username_bids
     WHERE payment_tx_hash = v_normalized_tx_hash
       AND status = 'accepted'
       AND id != p_bid_id
  ) OR EXISTS (
    SELECT 1
      FROM username_marketplace
     WHERE payment_tx_hash = v_normalized_tx_hash
       AND status = 'sold'
       AND id != p_listing_id
  ) THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_USED: Payment transaction % has already been used for another marketplace sale', v_normalized_tx_hash;
  END IF;

  UPDATE username_bids
     SET status              = 'accepted',
         payment_tx_hash     = v_normalized_tx_hash,
         payment_verified_at = now(),
         updated_at          = now()
   WHERE id = p_bid_id;

  UPDATE username_bids
     SET status = 'rejected', updated_at = now()
   WHERE listing_id = p_listing_id
     AND id != p_bid_id
     AND status = 'pending';

  UPDATE username_marketplace
     SET status           = 'sold',
         sold_at          = now(),
         buyer_public_key = v_bid.bidder_public_key,
         final_price      = v_bid.bid_amount,
         payment_tx_hash  = v_normalized_tx_hash,
         updated_at       = now()
   WHERE id = p_listing_id;

  UPDATE usernames
     SET public_key = v_bid.bidder_public_key
   WHERE username = v_listing.username;
END;
$$;
