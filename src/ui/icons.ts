import type { Element } from '../magic/Elements';

const svg = (inner: string, color: string) =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export function elementIcon(e: Element, color: string) {
  switch (e) {
    case 'fire':
      return svg(
        `<path d="M24 5c2 7 10 11 10 21a10 10 0 0 1-20 0c0-5 3-8 5-10 0 4 2 6 4 7-1-7 0-12 1-18z" fill="${color}" fill-opacity="0.35"/><path d="M24 30c3 2 4 5 2 8"/>`,
        color,
      );
    case 'ice':
      return svg(
        `<path d="M24 4v40M6.7 14l34.6 20M6.7 34l34.6-20"/><path d="M19 8l5 5 5-5M19 40l5-5 5 5M8 21l7-1-2-6M40 27l-7 1 2 6M8 27l7 1-2 6M40 21l-7-1 2-6"/>`,
        color,
      );
    case 'wind':
      return svg(
        `<path d="M5 17h24a6 6 0 1 0-6-6"/><path d="M5 26h32a6 6 0 1 1-6 6"/><path d="M9 35h12"/><path d="M11 9h6"/>`,
        color,
      );
    case 'lightning':
      return svg(`<path d="M28 4L10 27h12l-4 17 20-25H26l4-15z" fill="${color}" fill-opacity="0.35"/>`, color);
    case 'kinesis':
      return svg(
        `<path d="M16 26V12a3 3 0 0 1 6 0v11M22 22V9a3 3 0 0 1 6 0v13M28 22V11a3 3 0 0 1 6 0v14M34 24v-6a3 3 0 0 1 6 0v9c0 9-6 15-14 15-6 0-9-3-12-8l-5-8a3 3 0 0 1 5-3l4 5"/><circle cx="24" cy="4" r="2" fill="${color}"/>`,
        color,
      );
  }
}

export const heartPath = 'M12 21s-7.5-4.6-10-9.5C0.3 8 2 3.5 6.2 3.2 8.9 3 10.8 4.6 12 6.4 13.2 4.6 15.1 3 17.8 3.2 22 3.5 23.7 8 22 11.5 19.5 16.4 12 21 12 21z';
