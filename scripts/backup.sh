#!/bin/bash
BACKUP_DIR="/opt/backups/erp"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="erp_backup_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump and compress
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U postgres erp_db | gzip > "$BACKUP_DIR/$FILENAME"

# Remove backups older than 7 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "Backup done: $FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"
