with b as (
  insert into public.businesses (name, business_email, default_language)
  values ('Schneideratelier Demo', 'demo@handwerk.test', 'de')
  returning id
)
insert into public.business_users (business_id, user_id, role)
select b.id, '6ea3c382-e91b-4c82-aa25-8f242183ab34', 'owner' from b;
