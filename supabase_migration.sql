-- Supabase 数据库迁移脚本
-- 单账号多设备极简同步方案
-- 请在 Supabase SQL Editor 中手动执行此脚本

-- 1) 字段补全
alter table xhsphone_snapshot
  add column if not exists updated_at timestamptz default now(),
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists updated_by_name text;

-- 2) UNIQUE(key) 保障 upsert
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'xhsphone_snapshot_key_key'
  ) then
    alter table xhsphone_snapshot add constraint xhsphone_snapshot_key_key unique (key);
  end if;
end $$;

-- 3) Realtime
do $$
begin
  alter publication supabase_realtime add table xhsphone_snapshot;
exception when duplicate_object then
  null;
end $$;

-- 4) RLS + policy
alter table xhsphone_snapshot enable row level security;

-- 4.1 清理旧 policy（members 表可能不存在，必须包异常）
do $$
begin
  execute 'drop policy if exists "members_read_own" on xhsphone_members';
exception when undefined_table then
  null;
end $$;

drop policy if exists "read_policy" on xhsphone_snapshot;
drop policy if exists "insert_policy" on xhsphone_snapshot;
drop policy if exists "update_policy" on xhsphone_snapshot;
drop policy if exists "delete_policy" on xhsphone_snapshot;
drop policy if exists "Owner manages everything" on xhsphone_snapshot;

create policy "Owner manages everything" on xhsphone_snapshot
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

