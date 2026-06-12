---
title: "How to Migrate Your Supabase Project with Zero Downtime"
date: "2026-06-12"
description: "Learn the best practices for migrating your Supabase database, transferring schemas, and moving data between projects without experiencing downtime."
author: "Baseup Engineering"
---

Migrating a Supabase project from one organization to another, or moving from local development to a production environment, is a critical task. Whether you are scaling up, changing hosting regions, or consolidating projects, ensuring **zero downtime** during the migration process is essential for maintaining a seamless user experience.

In this guide, we will explore the challenges of Supabase migration and provide a structured approach to migrating your database without losing data or experiencing service interruptions.

## The Challenges of Supabase Migration

Supabase is built on top of PostgreSQL, which means migrating a project involves more than just copying tables. A complete migration requires transferring:

1. **Database Schema:** Tables, views, functions, and triggers.
2. **Row Level Security (RLS):** Security policies that dictate who can read or write data.
3. **Roles and Permissions:** Custom roles (`anon`, `authenticated`, `service_role`) specific to Supabase.
4. **Storage Objects:** Files stored in Supabase Storage buckets.
5. **Auth Users:** Registered users, encrypted passwords, and social identities.

Using traditional tools like `pg_dump` and `psql` requires meticulous execution. A simple foreign key constraint violation or a missing RLS policy can bring your new environment crashing down.

## Strategies for Zero Downtime

To achieve zero downtime, you must run the old and new databases in parallel while keeping data synchronized until the DNS switch is complete.

### Step 1: Schema Duplication
First, extract the schema from your origin database using the Supabase CLI. You must ensure you only grab the schema, omitting the actual rows of data:

```bash
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
```

Apply this schema to your new destination database. This ensures the target is structurally ready to accept data.

### Step 2: Continuous Data Replication (Logical Replication)
Instead of a single bulk export, set up PostgreSQL Logical Replication. This allows the target database to subscribe to changes happening on the origin database in real-time. 

When a user inserts a row on the live (old) database, the logical replication slot instantly pushes that change to the new database.

### Step 3: Application Configuration Switch
Once the target database is fully synchronized and caught up with the origin, update your application's environment variables (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`). 

Deploy your application. Because both databases are identical, users will seamlessly begin reading and writing to the new Supabase project.

## Automating with Baseup

While setting up logical replication manually is powerful, it requires deep PostgreSQL knowledge and extensive configuration. 

**Baseup** completely automates this process. By securely connecting to both your origin and target Supabase instances, Baseup handles:
- Exact schema duplication, including complex RLS policies.
- High-speed, server-to-server data streaming.
- Auth user and password hash migration.

With Baseup, a complex, high-risk migration becomes a single-click operation, ensuring your application remains online and your data remains secure.
