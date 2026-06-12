---
title: "Supabase Local Development to Production: A Comprehensive Guide"
date: "2026-06-12"
description: "Learn how to transition your Supabase project from a local development environment to a live production server using the CLI, migrations, and Baseup."
author: "Baseup DevOps Team"
---

Developing locally with Supabase provides an exceptional developer experience. You can spin up a complete PostgreSQL database, Auth server, and Storage API on your laptop using Docker. It’s fast, isolated, and completely free.

But what happens when you are ready to launch? Moving your local schema, test data, and configurations to a live, production Supabase project can be an intimidating process. 

This guide covers the standard workflows for pushing your local Supabase environment to production, and introduces automated alternatives for complex data transfers.

## The Supabase CLI Workflow

Supabase promotes a git-ops approach to database management using the Supabase CLI. Instead of making manual clicks in the dashboard, you define your database schema using migration files.

### 1. Generating Migrations
If you've been using Supabase Studio locally (`localhost:54323`) to create tables and columns visually, you must generate a migration file representing those changes:

```bash
supabase db diff -f initial_schema
```

This creates a new SQL file inside your `supabase/migrations` directory. 

### 2. Pushing to Production
Once your migration files are committed to version control, link your CLI to your live Supabase project and push the changes:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

This applies your schema changes to the production database safely. 

## The Missing Piece: Seeding and Test Data

The CLI workflow is fantastic for managing *schema* (the structure of your database), but it is explicitly not designed to move *data* (the actual rows inside your tables).

If you have built up a complex dataset locally—perhaps hundreds of test users, product catalogs, or mock transactions—you cannot use `supabase db push` to transfer them.

You could write custom SQL seed scripts (`supabase/seed.sql`), but this requires manual data entry. You could use `pg_dump` to export your local data and pipe it to your production URL, but this often leads to foreign key constraint violations and sequence mismatch errors.

## Bridging the Gap with Baseup

When you need to move actual data from local development to a staging environment, or from staging to production, manual scripts quickly become unmaintainable.

This is where **Baseup** comes in. Baseup acts as a bridge between any two Supabase environments. 

1. **Schema Sync:** Ensures your production environment structurally matches your local build.
2. **Data Streaming:** Automatically transfers table data while intelligently managing foreign key relationships and triggers to prevent constraint errors.
3. **Environment Parity:** Copies over storage buckets and authentication users securely.

With Baseup, taking your project from `localhost` to production is a seamless, visual experience, eliminating the anxiety of manual database administration.
