---
title: "Supabase Auth Taşıma: Kullanıcıları ve Şifreleri Güvenle Aktarma"
date: "2026-06-12"
description: "Şifrelenmiş parolaları ve oturum bütünlüğünü koruyarak Supabase Auth kullanıcılarını nasıl taşıyabilirsiniz?"
author: "Baseup SEO Team"
---

Bir taşıma işleminin en karmaşık kısmı kullanıcı kimlik doğrulama verilerini aktarmaktır. Düz metin şifreleri kopyalayamazsınız; Bcrypt/Argon2 özetlerini (hash) birebir aktarmanız gerekir.

## auth.users Tablosu

Supabase kullanıcıları `auth.users` tablosunda saklar. Bu tablonun taşınması özel yetkiler gerektirir.

## Otomatik Auth Aktarımı

Baseup tüm `auth` şemasını güvenle aktarır ve kullanıcıların şifre sıfırlamasına gerek kalmadan yeni projeye giriş yapmalarını sağlar.
