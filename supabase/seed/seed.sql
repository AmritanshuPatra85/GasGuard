-- Society A
with soc_a as (
  insert into societies (name, city) values ('Amrit Heights', 'Bhubaneswar')
  returning id
), tower_a as (
  insert into towers (society_id, name)
  select id, 'Tower 1' from soc_a
  returning id
), flat_a as (
  insert into flats (tower_id, number, floor)
  select id, '101', 1 from tower_a
  returning id
)
insert into memberships (user_id, flat_id, role)
select 'd51b2285-7a04-4dfd-b150-b6351cba2791'::uuid, id, 'resident' from flat_a;

-- Society B
with soc_b as (
  insert into societies (name, city) values ('Bob Gardens', 'Lucknow')
  returning id
), tower_b as (
  insert into towers (society_id, name)
  select id, 'Tower 1' from soc_b
  returning id
), flat_b as (
  insert into flats (tower_id, number, floor)
  select id, '202', 2 from tower_b
  returning id
)
insert into memberships (user_id, flat_id, role)
select 'fbbcba58-26d6-4ea7-ac49-1488e419e4e7'::uuid, id, 'resident' from flat_b;
