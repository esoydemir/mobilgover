-- Platform administration screen: the platform administrator can withdraw a platform role.
-- Granting already works (INSERT). Every change is written to the platform audit chain with its reason by the service,
-- and the service refuses self-changes and removing the last platform administrator.
GRANT DELETE ON platform_roles TO goverhub_app;
