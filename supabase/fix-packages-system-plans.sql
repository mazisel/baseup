-- Align existing pricing packages with the app model:
-- each package is a system plan, prices are stored as minor units for USD.

alter table public.packages
  alter column currency set default 'USD',
  alter column plan_id set default 'basic';

update public.packages
set
  currency = 'USD',
  plan_id = slug
where currency is distinct from 'USD'
   or plan_id is distinct from slug;
