---
title: "Understanding and Migrating Supabase Row Level Security (RLS) Policies"
date: "2026-06-12"
description: "A comprehensive guide to managing, testing, and safely migrating PostgreSQL Row Level Security (RLS) policies in your Supabase database."
author: "Baseup Security Team"
---

Row Level Security (RLS) is one of the most powerful features provided by PostgreSQL and heavily leveraged by Supabase. Instead of relying solely on your backend application logic to enforce permissions, RLS allows you to define security rules directly at the database layer.

However, when migrating a Supabase project, moving these policies accurately is critical. A single missing policy could inadvertently expose sensitive user data to the public internet.

In this guide, we dive into how RLS works in Supabase and how to migrate policies safely.

## How RLS Works in Supabase

Supabase uses PostgreSQL's native RLS. When you enable RLS on a table, all access is denied by default. You must explicitly create policies that return a boolean (`true` or `false`) to determine if a specific row can be accessed.

Supabase simplifies this by injecting JWT (JSON Web Token) claims into the database session context. The `auth.uid()` function is commonly used to compare the row's owner ID against the logged-in user.

```sql
CREATE POLICY "Users can only view their own profiles" 
ON public.profiles 
FOR SELECT 
USING ( auth.uid() = id );
```

## The Dangers of Manual RLS Migration

When developers use raw `pg_dump` commands to migrate databases, they often run into issues regarding RLS:

1. **Role Dependencies:** Supabase relies on custom PostgreSQL roles (`anon`, `authenticated`, `service_role`). If your dump script attempts to recreate policies before these roles exist on the target server, the migration will fail.
2. **Execution Order:** Policies often reference custom functions (e.g., `is_admin()`). If the migration script applies policies before creating the referenced functions, it will throw an error.
3. **Implicit Disabling:** Sometimes, to bypass foreign key constraints during data import, developers use `session_replication_role = replica`. If not handled carefully, this can cause unintended side effects during RLS re-activation.

## The Right Way to Migrate RLS

To ensure a flawless security migration, follow this strict order of operations:

1. **Create Custom Types & Enums**
2. **Create Tables & Views**
3. **Create Functions & Triggers** (This ensures any functions referenced by your RLS policies exist).
4. **Enable RLS on Tables:** `ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;`
5. **Apply Policies:** Now it is safe to execute your `CREATE POLICY` statements.

## Seamless Migration with Baseup

Managing the exact execution topology of database schemas can be a nightmare, especially for mature projects with dozens of interrelated tables and policies.

**Baseup** solves this by analyzing your database schema and automatically determining the correct topological sort order for execution. When you migrate your Supabase project using Baseup, all RLS policies, custom roles, and security contexts are perfectly mirrored in the destination database—guaranteeing that your data remains strictly protected from day one.
