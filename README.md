# ProjectPay - Sales & Stock Management System

A modern web-based sales and stock management system similar to Optimo/Fina/1C.

## Features
- User authentication with role-based access
- Product and stock management
- Cashier management
- Payment tracking and transactions
- Advanced filtering and search
- Excel & PDF export
- Real-time dashboard with metrics

## Tech Stack
- **Backend**: Node.js + Express.js + TypeScript
- **Frontend**: React.js + TypeScript + Tailwind CSS
- **Database**: PostgreSQL
- **Authentication**: JWT

## Project Structure
```
projectpay/
├── backend/           # Node.js/Express API server
├── frontend/          # React.js web application
└── docs/             # Documentation
```

## Getting Started

### Prerequisites
- Node.js 16+
- PostgreSQL 12+
- npm or yarn

### Quick Start

1. **Backend Setup**
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

2. **Frontend Setup**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

3. **Database Setup**
```bash
npm run migrate
npm run seed
```

## API Documentation
See `/docs` for detailed API documentation.

## License
MIT
