# Carz Inc - Vehicle Management System

## Overview
Comprehensive vehicle inventory management, inspection, and analytics platform for Carz Inc.

## Features

### 🚗 Inventory Management
- Real-time vehicle tracking and location management
- Buyer-specific filtering and organization
- Missing vehicle alerts and status updates
- Export capabilities for reporting

### 📊 Vehicle Analytics
- Multi-dimensional filtering (Make/Model/Year/Mileage)
- Buyer and vendor performance tracking
- Sales timeline and profit analysis
- ROI calculations and trend monitoring

### 📱 Smart Auction Extension
- Automated data extraction from auction sites
- Correct cost calculations (Original Cost + Added Costs = Total)
- VIN matching and vehicle identification
- Inventory synchronization

### 📝 Inspection System
- Multi-step inspection workflow
- Photo capture and damage documentation
- Condition tracking and reporting
- Integration with inventory management

## Tech Stack
- **Frontend**: React, Vite, Tailwind CSS
- **Backend**: Supabase
- **Extensions**: Chrome/Edge extensions for auction sites
- **Database**: PostgreSQL (via Supabase)

## Setup

### Inspection App
```bash
cd inspection-app
npm install
npm run dev
```

### Smart Auction Extension
1. Open Chrome/Edge
2. Navigate to extensions page
3. Enable Developer Mode
4. Load unpacked extension from `scrapers/smartauction-extension`

## Deployment
The inspection app is deployed on Vercel at carzinc.ai

## License
Proprietary - Carz Inc © 2024