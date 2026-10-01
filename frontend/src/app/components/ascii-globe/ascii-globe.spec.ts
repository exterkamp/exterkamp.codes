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
    // Real PointerEvents with a numeric pointerId, like a browser sends, so the
    // pointerId filtering in the component is actually exercised.
    const fire = (type: string, init: PointerEventInit & { target?: EventTarget } = {}) =>
      (init.target ?? pre).dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, buttons: 1, ...init }));

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

    it('ignores other pointers while dragging (e.g. a second finger)', () => {
      fire('pointerdown', { clientX: 0 });
      const before = pre.textContent;

      fire('pointermove', { pointerId: 2, clientX: 60 });
      expect(pre.textContent).toBe(before);

      fire('pointerup', { pointerId: 2, target: window });
      fire('pointercancel', { pointerId: 2, target: window });
      expect(pre.classList).toContain('dragging');

      fire('pointerdown', { pointerId: 2, clientX: 0 }); // can't start a second drag
      fire('pointerup', { pointerId: 1, target: window });
      expect(pre.classList).not.toContain('dragging');
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
