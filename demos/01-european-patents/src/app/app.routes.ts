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
        path: 'patents',
        loadComponent: () =>
          import('./pages/patents/patents-list').then((m) => m.PatentsList),
      },
      {
        path: 'patents/:id',
        loadComponent: () =>
          import('./pages/patents/patent-detail').then((m) => m.PatentDetail),
      },
      {
        path: 'applicants',
        loadComponent: () =>
          import('./pages/applicants/applicants-list').then(
            (m) => m.ApplicantsList
          ),
      },
      {
        path: 'trends',
        loadComponent: () =>
          import('./pages/trends/trends').then((m) => m.Trends),
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
