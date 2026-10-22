CREATE TABLE IF NOT EXISTS applications (
    tracking_code VARCHAR(80) NOT NULL PRIMARY KEY,
    record_json JSON NOT NULL,
    submitted_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    INDEX applications_submitted_idx (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    username VARCHAR(120) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT '',
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX sessions_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    bucket CHAR(64) NOT NULL PRIMARY KEY,
    failures INT NOT NULL DEFAULT 0,
    window_started DATETIME NOT NULL,
    locked_until DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_sync (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

INSERT IGNORE INTO application_sync (id, revision) VALUES (1, 0);
