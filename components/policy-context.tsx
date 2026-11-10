'use client';

import { createContext, useContext } from 'react';
import { POLICY } from '@/lib/policy';
import type { Policy } from '@/lib/policy';

/** The policy lines in force right now: the defaults, plus anything the manager moved. */
export const PolicyContext = createContext<Policy>({ ...POLICY });
export const usePolicy = () => useContext(PolicyContext);
