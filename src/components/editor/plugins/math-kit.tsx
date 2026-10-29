'use client';

import {toPlatePlugin} from 'platejs/react';
import {BaseEquationPlugin,BaseInlineEquationPlugin} from '@/plate-math-plugins';

import { MathEquationElement as EquationElement, MathEquationElement as InlineEquationElement } from '@/plate-math-element';

export const MathKit = [
  toPlatePlugin(BaseInlineEquationPlugin).configure({
    node: {
      component: InlineEquationElement,
    },
  }),
  toPlatePlugin(BaseEquationPlugin).configure({
    node: {
      component: EquationElement,
    },
  }),
];
