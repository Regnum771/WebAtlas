import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberValue } from './NumberValue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './shadcn/tabs';

describe('NumberValue', () => {
  it('reads the value in Vietnamese format with its unit', () => {
    render(<NumberValue value={1234.5} unit="km²" format={{ maximumFractionDigits: 1 }} />);
    expect(screen.getByText('1.234,5 km²')).toHaveClass('sr-only');
  });

  it('shows a dash, still with its unit, while there is no value', () => {
    render(<NumberValue value={null} unit="m" />);
    expect(screen.getByText('— m')).toBeInTheDocument();
  });

  it('draws its digits in the number font', () => {
    const { container } = render(<NumberValue value={3} unit="m" />);
    expect(container.querySelector('[data-slot="number-value"]')).toHaveClass('font-num');
  });
});

describe('Tabs (underline)', () => {
  it('switches tab with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Thẻ">
          <TabsTrigger value="a">Một</TabsTrigger>
          <TabsTrigger value="b">Hai</TabsTrigger>
        </TabsList>
        <TabsContent value="a">nội dung một</TabsContent>
        <TabsContent value="b">nội dung hai</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByRole('tab', { name: 'Một' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Hai' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('nội dung hai')).toBeVisible();
  });

  it('marks the active tab with the brand underline, never a filled segment', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList><TabsTrigger value="a">Một</TabsTrigger></TabsList>
      </Tabs>,
    );
    const tab = screen.getByRole('tab', { name: 'Một' });
    expect(tab).toHaveClass('border-b-2', 'data-[state=active]:border-brand');
    expect(tab.className).not.toMatch(/bg-(?!transparent)/);
  });
});
