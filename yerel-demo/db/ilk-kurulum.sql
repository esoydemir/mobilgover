-- Yalnızca veritabanı ilk kez oluşturulurken çalışır (boş birimde). Sonraki başlatmalarda çalışmaz.
-- Parolalar yerel demoya özeldir: veritabanı hiçbir porta yayınlanmaz, yalnızca iç ağdaki API bağlanır.
CREATE ROLE goverhub_owner LOGIN PASSWORD 'yerel-demo-owner';
CREATE ROLE goverhub_app LOGIN PASSWORD 'yerel-demo-app';
CREATE DATABASE goverhub_demo OWNER goverhub_owner;
REVOKE ALL ON DATABASE goverhub_demo FROM PUBLIC;
GRANT CONNECT ON DATABASE goverhub_demo TO goverhub_app;
