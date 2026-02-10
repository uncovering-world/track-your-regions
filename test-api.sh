#!/bin/bash
# Quick test script for backend API

echo "=== Testing Track Your Regions New-Gen API ==="
echo ""

BASE_URL="http://localhost:3001"

echo "1. Health Check"
curl -s "$BASE_URL/health" | head -c 200
echo -e "\n"

echo "2. Get World Views"
curl -s "$BASE_URL/api/world-views" | head -c 500
echo -e "\n"

echo "3. Get Root Divisions"
curl -s "$BASE_URL/api/divisions/root" | head -c 500
echo -e "\n"

echo "4. Get Division 2 (Europe)"
curl -s "$BASE_URL/api/divisions/2" | head -c 200
echo -e "\n"

echo "5. Get Subdivisions of Europe"
curl -s "$BASE_URL/api/divisions/2/subdivisions" | head -c 500
echo -e "\n"

echo "6. Get Views"
curl -s "$BASE_URL/api/views" | head -c 500
echo -e "\n"

echo "=== Done ==="
