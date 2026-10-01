import { TestBed } from '@angular/core/testing';
import { AsciiGlobe } from './ascii-globe';

describe('AsciiGlobe', () => {
  it('renders a decorative globe', async () => {
    const fixture = TestBed.createComponent(AsciiGlobe);
    await fixture.whenStable();
    const pre: HTMLPreElement = fixture.nativeElement.querySelector('pre');
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.textContent!.split('\n').length).toBeGreaterThan(10);
  });

  describe('dragging', () => {
    let pre: HTMLPreElement;
    const fire = (type: string, init: MouseEventInit & { target?: EventTarget } = {}) =>
      (init.target ?? pre).dispatchEvent(new MouseEvent(type, { bubbles: true, buttons: 1, ...init }));

    beforeEach(async () => {
      const fixture = TestBed.createComponent(AsciiGlobe);
      await fixture.whenStable();
      pre = fixture.nativeElement.querySelector('pre');
    });

    it('turns when dragged horizontally, and only while the pointer is down', () => {
      fire('pointermove', { clientX: 10 }); // not pressed: ignored
      const before = pre.textContent;
      fire('pointerdown', { clientX: 0 });
      fire('pointermove', { clientX: 30 });
      const dragged = pre.textContent;
      expect(dragged).not.toBe(before);

      fire('pointerup', { clientX: 30 });
      fire('pointermove', { clientX: 60 });
      expect(pre.textContent).toBe(dragged);
    });

    it('ends the drag when released outside the globe', () => {
      fire('pointerdown');
      expect(pre.classList).toContain('dragging');
      fire('pointerup', { target: window });
      expect(pre.classList).not.toContain('dragging');
    });

    it('recovers if the release was missed', () => {
      fire('pointerdown', { clientX: 0 });
      fire('pointermove', { clientX: 30, buttons: 0 }); // moved with no button held
      expect(pre.classList).not.toContain('dragging');
      const frozen = pre.textContent;
      fire('pointermove', { clientX: 90 });
      expect(pre.textContent).toBe(frozen);
    });

    it('ignores non-primary buttons and ends on context menu or blur', () => {
      fire('pointerdown', { button: 2 });
      expect(pre.classList).not.toContain('dragging');

      fire('pointerdown');
      fire('contextmenu');
      expect(pre.classList).not.toContain('dragging');

      fire('pointerdown');
      fire('blur', { target: window });
      expect(pre.classList).not.toContain('dragging');
    });
  });
});
