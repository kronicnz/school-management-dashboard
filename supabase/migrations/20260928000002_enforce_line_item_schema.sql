-- Enforce the line-item schema on finance_invoice_candidates.line_items so malformed
-- rows cannot be persisted. PostgreSQL does not allow subqueries in CHECK constraints, so
-- the invariant is enforced with a BEFORE trigger. The application layer
-- (validateLineItemsForXero in the finance-intake edge function) enforces the same
-- contract again immediately before posting to Xero, but the trigger makes the invariant
-- structural rather than relying on every writer to remember.
--
-- Each row must be an object carrying a description, a positive quantity, non-negative
-- unit_amount and line_amount, and a recognised tax_type. account_code is optional but,
-- when present, must be a 3-6 digit code.

create or replace function public.validate_finance_line_items()
returns trigger
language plpgsql
as $$
declare
  item jsonb;
  qty text;
  unit text;
  line text;
  tax text;
  acct text;
begin
  if new.line_items is null then
    return new;
  end if;

  if jsonb_typeof(new.line_items) <> 'array' then
    raise exception 'finance_invoice_candidates.line_items must be a JSON array';
  end if;

  for item in select jsonb_array_elements(new.line_items) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'finance_invoice_candidates.line_items contains a non-object row';
    end if;

    if coalesce(item->>'Description', item->>'description', '') = '' then
      raise exception 'finance_invoice_candidates.line_items row is missing a description';
    end if;

    qty := coalesce(item->>'Quantity', item->>'quantity');
    if qty is null or qty::numeric <= 0 then
      raise exception 'finance_invoice_candidates.line_items row has an invalid quantity';
    end if;

    unit := coalesce(item->>'UnitAmount', item->>'unit_amount');
    if unit is null or unit::numeric < 0 then
      raise exception 'finance_invoice_candidates.line_items row has an invalid unit amount';
    end if;

    line := coalesce(item->>'LineAmount', item->>'line_amount');
    if line is null or line::numeric < 0 then
      raise exception 'finance_invoice_candidates.line_items row has an invalid line amount';
    end if;

    tax := coalesce(item->>'TaxType', item->>'tax_type');
    if tax is null or tax not in (
      'INPUT', 'INPUT2', 'OUTPUT', 'OUTPUT2', 'NONE',
      'GSTONIMPORTS', 'ZERO', 'EXEMPTOUTPUT', 'EXEMPTINPUT'
    ) then
      raise exception 'finance_invoice_candidates.line_items row has an invalid tax type';
    end if;

    acct := coalesce(item->>'AccountCode', item->>'account_code');
    if acct is not null and acct !~ '^\d{3,6}$' then
      raise exception 'finance_invoice_candidates.line_items row has an invalid account code';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists finance_invoice_candidates_line_items_check on public.finance_invoice_candidates;
create trigger finance_invoice_candidates_line_items_check
before insert or update on public.finance_invoice_candidates
for each row execute function public.validate_finance_line_items();