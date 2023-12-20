# Frontend Application for Region Tracker

## Overview

This directory contains the frontend application for the Region Tracker service. The application provides the user interface for interacting with the service and visualizing region data.

## Tech Stack

- **React**: The library used for building the user interface.
- **Axios**: Promise-based HTTP client for making API calls.
- **@mui/material**: Material-UI library for React components.
- **Docker**: Used for containerizing the frontend service for quick setup and testing.

## Code Style

We use [Airbnb's JavaScript style guide](https://github.com/airbnb/javascript) for this project. 
To ensure that the codebase adheres to this style guide, we use eslint to lint the codebase. The configuration file is `.eslintrc`.

To run the linter, use the following command:

```bash
npm run lint
```

To automatically fix linting errors, use the following command:

```bash
npm run lint:fix
```

## Directory Structure

```
.
├── public
│   └── index.html                    # HTML template
├── src
│   ├── api
│   │   └── index.js                  # API interactions
│   ├── components                    # UI Components
│   │   ├── BreadcrumbNavigation.jsx
│   │   ├── Footer.jsx
│   │   ├── Header.jsx
│   │   ├── HierarchySwitcher.jsx
│   │   ├── ListOfRegions.jsx
│   │   ├── MainDisplay.jsx
│   │   ├── NavigationPane.jsx
│   │   ├── RegionMap.jsx
│   │   ├── Search.jsx
│   │   └── NavigationContext.jsx
│   ├── App.jsx                       # Main application component
│   └── index.js                      # Application entry point
├── Dockerfile                        # Dockerfile for containerization (for docker-compose use only)
├── README.md                         # Documentation
└── package.json                      # Project metadata and dependencies
```

## Environment Configuration

We use `.env` files to manage environment variables. The hierarchy is as follows:

- `.env`: Common settings
- `.env.development`: For development settings
- `.env.production`: For production settings
- `.env.local`: For local overrides

The repository contains an example `.env.development` file.

## Usage

### With Docker Compose

The `Dockerfile` in this directory is intended solely for use by `docker-compose`. While it can work independently, it's not recommended. For individual component testing and debugging, it's advised to use npm directly.

To run the frontend service as part of the full stack, refer to the main `README.md` in the `deployment/` directory for instructions on using `docker-compose`.

### Without Docker Compose

To run the frontend service individually:

```bash
npm install
npm start
```

## Available Scripts

- `npm start`: Starts the development server.
- `npm build`: Builds the production version of the app.
- `npm test`: Run tests (currently not specified).
- `npm eject`: Ejects the setup (Note: this is a one-way operation).
- `npm run lint`: Lints the codebase.

## Features

### Search

The application includes a search feature that allows users to quickly find
regions by name. This feature is implemented in the frontend and interacts
with the backend to fetch search results.

#### UI/UX Considerations:

- **Search Bar Placement**: Integrated at the top of the navigation pane,
  ensuring high visibility and ease of access for users.
- **Responsive Autocomplete**: Implements a responsive autocomplete mechanism.
  As users type in the search bar, suggestions are dynamically generated based
  on the input, providing a smooth and interactive user experience.
- **Search Efficiency & Debouncing**: Optimized for performance, the search 
  feature includes debouncing to limit the number of backend calls, enhancing
  efficiency, especially when dealing with large datasets.
- **Search Result Formatting**: Search results display the region name, along
  with a unique path or identifier when similar names exist. This helps users
  distinguish between regions with identical names.
- **Keyboard Navigation Support**: Users can navigate through search results
  using keyboard arrows, enhancing accessibility and ease of use.

