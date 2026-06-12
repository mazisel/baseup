---
title: "PostgreSQL Logical Replication vs. pg_dump for Supabase"
date: "2026-06-12"
description: "Comparing the two main methods for database migration and when to use them for your Supabase project."
author: "Baseup SEO Team"
---

When migrating a database, you typically choose between a logical dump (`pg_dump`) or logical replication.

## pg_dump: The Standard

`pg_dump` is reliable but requires downtime. You must stop your app, dump the data, and restore it.

## Logical Replication: Zero Downtime

Replication streams data live. It's complex to set up but provides zero downtime. Baseup provides a visual interface for managing logical replication natively.
