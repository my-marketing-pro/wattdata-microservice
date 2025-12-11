#!/bin/bash

# Dev server with auto-logging
# Logs are written to server-logs.txt and reset on each GET / 200 request

LOG_FILE="server-logs.txt"

# Clear the log file at start
> "$LOG_FILE"

echo "Starting dev server with logging to $LOG_FILE"
echo "Log file will reset on each 'GET / 200' request"
echo "Press Ctrl+C to stop"
echo ""

# Run npm dev and pipe through awk to handle log rotation
npm run dev 2>&1 | while IFS= read -r line; do
    # Print to terminal
    echo "$line"

    # Check if this is a GET / 200 request (page load)
    if echo "$line" | grep -q "GET / 200"; then
        # Reset the log file
        > "$LOG_FILE"
        echo "[Log file reset at $(date)]" >> "$LOG_FILE"
    fi

    # Append to log file
    echo "$line" >> "$LOG_FILE"
done
