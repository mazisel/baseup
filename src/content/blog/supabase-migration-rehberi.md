---
title: "Supabase Migration Rehberi: Projenizi Kesintisiz Nasıl Taşırsınız?"
date: "2026-06-12"
description: "Supabase projeleri arasında veritabanı şemalarını ve verileri kesintisiz ve güvenli bir şekilde nasıl taşıyacağınızı adım adım anlatan kapsamlı bir rehber."
author: "Baseup Team"
---

Supabase kullanarak geliştirdiğiniz bir projeyi, yeni bir Supabase organizasyonuna veya farklı bir projeye taşımak her zaman zorlu bir süreç olmuştur. Veritabanı şemasını (schema) kayıpsız aktarmak, RLS (Row Level Security) kurallarını korumak ve en önemlisi verileri (data) düzgün bir şekilde yeni sunucuya kopyalamak oldukça zaman alır.

Bu rehberde, bir Supabase projesini taşırken dikkat etmeniz gereken kritik adımları ve **Baseup** platformunun bu süreci nasıl otomatize ettiğini inceleyeceğiz.

## Geleneksel Yöntemler Neden Zor?

Supabase'in sunduğu CLI (Komut Satırı Arayüzü) araçları oldukça güçlüdür. Ancak manuel taşıma işlemi yaparken şu komutlarla uğraşmanız gerekir:

```bash
# Geleneksel şema taşıma örneği
supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
```

Bu yöntemde sadece şemayı alırsınız. Verileri (satırları) taşımak için ise `pg_dump` ve `psql` komutlarını spesifik bayraklarla (flags) çalıştırmanız, yabancı anahtar (foreign key) çakışmalarını önlemek için trigger'ları devre dışı bırakmanız gerekir. Eğer sunucunuzda GB'larca veri varsa, yerel bilgisayarınızın ağ bant genişliği (bandwidth) bir darboğaz (bottleneck) oluşturacaktır.

## Baseup ile Tek Tıkla Taşıma

Baseup, bu karmaşık komut dizilerini arka planda tamamen güvenli ve izole bir ortamda çalıştırır.

1. **Bağlantı Ayarları:** Eski ve yeni projenizin sadece veritabanı şifrelerini (db_password) sisteme girmeniz yeterlidir. Baseup bu şifreleri veritabanına kaydetmez; işlemi anlık olarak bellekte (RAM) gerçekleştirir.
2. **Roller ve RLS:** Taşıma işleminde ilk olarak Supabase'in özel rolleri (`anon`, `authenticated`, `service_role`) ve güvenlik kuralları aktarılır.
3. **Veri Kopyalama:** Sunucular arası doğrudan (Server-to-Server) bağlantı kurularak yüksek hızda kopyalama yapılır. İnternet hızınıza bağlı kalmadan dakikalar içinde GB'larca veri aktarılır.

### Sonuç

Bir projeyi taşımak eskiden saatler sürerken, artık kahvenizi yudumlarken arayüz üzerinden ilerlemeyi canlı olarak izleyebildiğiniz bir deneyime dönüştü. Baseup'ı hemen denemek için [Giriş Yap](/auth/login) sayfasından kayıt olabilirsiniz.
