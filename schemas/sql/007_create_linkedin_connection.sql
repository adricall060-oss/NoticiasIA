-- OAuth connection data for LinkedIn posting per tenant.
-- Run after base V1/V2 schema creation.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS IN_LINKEDIN_CONEXION (
  id_linkedin_conexion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_cliente BIGINT UNSIGNED NOT NULL,
  id_usuario_conectado BIGINT UNSIGNED NULL,
  linkedin_member_id VARCHAR(120) NULL,
  author_urn VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NULL,
  access_token_expires_at DATETIME NULL,
  refresh_token_expires_at DATETIME NULL,
  scopes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_linkedin_conexion),
  UNIQUE KEY uk_in_linkedin_conexion_cliente (id_cliente),
  KEY idx_in_linkedin_usuario (id_usuario_conectado),
  CONSTRAINT fk_in_linkedin_cliente
    FOREIGN KEY (id_cliente) REFERENCES OR_CLIENTE(id_cliente)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
