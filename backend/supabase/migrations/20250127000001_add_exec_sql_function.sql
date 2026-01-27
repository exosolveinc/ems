-- Function to execute SQL queries (SELECT only)
-- Used by AI chat features to run dynamically generated queries

CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  -- Validate: only SELECT allowed
  IF NOT (UPPER(TRIM(query)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous operations
  IF UPPER(query) ~ '(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)' THEN
    RAISE EXCEPTION 'Query contains forbidden operation';
  END IF;

  -- Execute and return as JSON
  EXECUTE 'SELECT json_agg(t) FROM (' || query || ') t' INTO result;

  -- Return empty array if null
  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- Grant execute to authenticated users (edge functions use service role anyway)
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;
