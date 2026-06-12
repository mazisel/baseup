---
title: "Supabase Auth Migration: Moving Users and Passwords Safely"
date: "2026-06-12"
description: "How to migrate Supabase Auth users, retaining their encrypted passwords and session integrity."
author: "Baseup SEO Team"
---

One of the most complex parts of a migration is moving user authentication data. You cannot simply copy plaintext passwords; you must transfer the exact Bcrypt/Argon2 hashes.

## The auth.users Table

Supabase stores users in the `auth.users` table. Moving this table requires elevated privileges that standard users don't have.

## Automated Auth Transfer

Baseup safely transfers your entire `auth` schema, ensuring users can log in to your new project without needing to reset their passwords.
