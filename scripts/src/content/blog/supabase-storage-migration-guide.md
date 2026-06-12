---
title: "Supabase Storage Migration: Transferring Files Between Projects"
date: "2026-06-12"
description: "A guide to moving S3-compatible storage buckets and files across Supabase projects."
author: "Baseup SEO Team"
---

Your database is only half the picture. Modern applications rely heavily on Supabase Storage for avatars, documents, and media.

## The Manual Way

You can use S3 CLI tools or rclone to copy files between buckets. However, this doesn't migrate the metadata stored in the `storage.objects` table.

## Complete Storage Migration

Baseup transfers both the physical files and the underlying metadata tables simultaneously, keeping your application's file references intact.
