import { AfterViewInit, Component, ElementRef, signal, viewChild } from '@angular/core';

const DEFAULT_ACCENT_HUE = 240;
const DEFAULT_LIGHTNESS = 0.93;
const DEFAULT_CHROMA = 0.03;

@Component({
  imports: [],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home implements AfterViewInit {
  readonly currentYear = new Date().getFullYear();

  private readonly colorControls = viewChild.required<ElementRef<HTMLElement>>('colorControls');

  controlsVisible = signal(false);
  accentHue = signal(this.readStoredNumber('accent-hue', DEFAULT_ACCENT_HUE));
  lightness = signal(DEFAULT_LIGHTNESS);
  chroma = signal(DEFAULT_CHROMA);

  private dragOrigin = { clickX: 0, clickY: 0, top: 0, right: 0 };
  private readonly onPointerMove = (event: PointerEvent) => this.handleDragMove(event);
  private readonly onPointerUp = () => this.handleDragEnd();

  constructor() {
    const storedHue = localStorage.getItem('accent-hue');
    if (storedHue) {
      document.documentElement.style.setProperty('--accent-hue', storedHue);
    }
  }

  ngAfterViewInit(): void {
    const el = this.colorControls().nativeElement;

    const storedTop = localStorage.getItem('control-top');
    const storedRight = localStorage.getItem('control-right');
    if (storedTop && storedRight) {
      el.style.top = `${storedTop}px`;
      el.style.right = `${storedRight}px`;
    }

    const computed = getComputedStyle(el);
    this.dragOrigin.top = parseInt(computed.getPropertyValue('top'), 10);
    this.dragOrigin.right = parseInt(computed.getPropertyValue('right'), 10);

    this.controlsVisible.set(true);
  }

  onHueChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.accentHue.set(Number(value));
    document.documentElement.style.setProperty('--accent-hue', value);
    localStorage.setItem('accent-hue', value);
  }

  onLightnessChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.lightness.set(Number(value));
    document.documentElement.style.setProperty('--lightness', value);
    localStorage.setItem('lightness', value);
  }

  onChromaChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.chroma.set(Number(value));
    document.documentElement.style.setProperty('--chroma', value);
    localStorage.setItem('chroma', value);
  }

  onDragStart(event: PointerEvent): void {
    event.preventDefault();
    this.dragOrigin.clickX = event.clientX;
    this.dragOrigin.clickY = event.clientY;
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp, { once: true });
  }

  private handleDragMove(event: PointerEvent): void {
    event.preventDefault();
    const el = this.colorControls().nativeElement;
    const newRight = this.dragOrigin.clickX - event.clientX;
    const newTop = this.dragOrigin.clickY - event.clientY;
    el.style.top = `${this.dragOrigin.top - newTop}px`;
    el.style.right = `${this.dragOrigin.right + newRight}px`;
  }

  private handleDragEnd(): void {
    document.removeEventListener('pointermove', this.onPointerMove);
    const el = this.colorControls().nativeElement;
    const computed = getComputedStyle(el);
    this.dragOrigin.top = parseInt(computed.getPropertyValue('top'), 10);
    this.dragOrigin.right = parseInt(computed.getPropertyValue('right'), 10);
    localStorage.setItem('control-top', String(this.dragOrigin.top));
    localStorage.setItem('control-right', String(this.dragOrigin.right));
  }

  private readStoredNumber(key: string, fallback: number): number {
    const stored = localStorage.getItem(key);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
