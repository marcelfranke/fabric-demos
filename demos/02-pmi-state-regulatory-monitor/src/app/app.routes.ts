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
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

