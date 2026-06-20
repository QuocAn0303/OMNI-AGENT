#!/bin/bash
# Script setup Ollama models cho Aduu ERP AI
# Chay sau khi Ollama service da start

set -e

OLLAMA_HOST=${OLLAMA_URL:-http://localhost:11434}

echo "=== Aduu AI Setup ==="
echo "Ollama host: $OLLAMA_HOST"

# Doi Ollama san sang
echo "Dang doi Ollama khoi dong..."
for i in $(seq 1 30); do
  if curl -sf "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
    echo "Ollama da san sang!"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "Timeout: Ollama khong phan hoi sau 30 giay"
    exit 1
  fi
  sleep 1
done

# Pull chat model
CHAT_MODEL=${OLLAMA_CHAT_MODEL:-gemma2:9b}
echo "\nDang tai chat model: $CHAT_MODEL ..."
curl -sf "$OLLAMA_HOST/api/pull" -d "{\"name\": \"$CHAT_MODEL\"}" | tail -1
echo "Chat model OK!"

# Pull embedding model
EMBED_MODEL=${OLLAMA_EMBED_MODEL:-nomic-embed-text}
echo "\nDang tai embedding model: $EMBED_MODEL ..."
curl -sf "$OLLAMA_HOST/api/pull" -d "{\"name\": \"$EMBED_MODEL\"}" | tail -1
echo "Embedding model OK!"

echo "\n=== Setup hoan tat ==="
echo "Chat model:     $CHAT_MODEL"
echo "Embed model:    $EMBED_MODEL"
echo "\nBuoc tiep theo: Goi POST /api/ai/sync de index du lieu ERP."
