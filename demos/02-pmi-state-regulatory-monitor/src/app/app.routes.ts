import type { Routes } from '@angular/router';

import { authGuard, noAuthGuard } from './auth.guard';
import { setupGuard } from './setup.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./pages/auth/auth').then((m) => m.Auth),
  },
  {
    path: 'setup',
    canActivate: [authGuard, setupGuard],
    loadComponent: () => import('./pages/setup/setup').then((m) => m.Setup),
  },
  {
    path: '',
    canActivate: [authGuard, setupGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'programs',
        loadComponent: () =>
          import('./pages/programs/programs-list').then((m) => m.ProgramsList),
      },
      {
        path: 'programs/:id',
        loadComponent: () =>
          import('./pages/programs/program-detail').then((m) => m.ProgramDetail),
      },
      {
        path: 'regulatory',
        loadComponent: () =>
          import('./pages/regulatory/regulatory-list').then((m) => m.RegulatoryList),
      },
      {
        path: 'regulatory/:id',
        loadComponent: () =>
          import('./pages/regulatory/regulatory-detail').then((m) => m.RegulatoryDetail),
      },
      {
        path: 'states',
        loadComponent: () =>
          import('./pages/states/states-list').then((m) => m.StatesList),
      },
      {
        path: 'states/:code',
        loadComponent: () =>
          import('./pages/states/state-detail').then((m) => m.StateDetail),
      },
      {
        path: 'alerts',
        loadComponent: () => import('./pages/alerts/alerts').then((m) => m.Alerts),
      },
      {
        path: 'revenue',
        loadComponent: () => import('./pages/revenue/revenue').then((m) => m.Revenue),
      },
      {
        path: 'timeline',
        loadComponent: () =>
          import('./pages/timeline/timeline').then((m) => m.Timeline),
      },
      {
        path: 'ask',
        loadComponent: () => import('./pages/ask/ask').then((m) => m.Ask),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

