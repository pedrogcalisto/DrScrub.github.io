import { NgClass } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import lottie, { type AnimationItem } from 'lottie-web';
import cleaningYellowHand from '../../animation/Cleaning Yellow Hand.json';
import { SITE_CONFIG } from '../../config/site.config';

/** Must match how many times the client list is repeated in `marqueeItems`. */
const MARQUEE_SEGMENTS = 4;

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [NgClass],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss',
  animations: [
    trigger('heroEnter', [
      transition(':enter', [
        query(
          '.hero__eyebrow, .hero__title, .hero__lede, .hero__actions, .hero__stats',
          [
            style({ opacity: 0, transform: 'translateY(28px)' }),
            stagger(80, [
              animate(
                '720ms cubic-bezier(0.22, 1, 0.36, 1)',
                style({ opacity: 1, transform: 'translateY(0)' }),
              ),
            ]),
          ],
          { optional: true },
        ),
      ]),
    ]),
    trigger('cardStagger', [
      transition(':enter', [
        query(
          '.card',
          [
            style({ opacity: 0, transform: 'translateY(36px) scale(0.98)' }),
            stagger(110, [
              animate(
                '780ms cubic-bezier(0.22, 1, 0.36, 1)',
                style({ opacity: 1, transform: 'translateY(0) scale(1)' }),
              ),
            ]),
          ],
          { optional: true },
        ),
      ]),
    ]),
    trigger('marqueeEnter', [
      transition(':enter', [
        query(
          '.marquee__item',
          [
            style({ opacity: 0, transform: 'translateY(12px)' }),
            stagger(40, [
              animate(
                '520ms cubic-bezier(0.22, 1, 0.36, 1)',
                style({ opacity: 1, transform: 'translateY(0)' }),
              ),
            ]),
          ],
          { optional: true },
        ),
      ]),
    ]),
    trigger('footerRise', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(32px)' }),
        animate('800ms cubic-bezier(0.22, 1, 0.36, 1)', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
})
export class LandingPageComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly site = SITE_CONFIG;
  readonly year = new Date().getFullYear();

  readonly telHref = `tel:${SITE_CONFIG.contact.phoneE164}`;

  readonly mapsHref =
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(`${SITE_CONFIG.contact.addressLine1}, ${SITE_CONFIG.contact.addressLine2}`);

  readonly smsQuoteHref = `sms:${SITE_CONFIG.contact.phoneE164}&body=${encodeURIComponent(
    `Hi ${SITE_CONFIG.brand} — I'd like a quote for floor care in ${SITE_CONFIG.serviceAreaShort}.`,
  )}`;
  readonly marqueeItems = [...Array(MARQUEE_SEGMENTS)].flatMap(() => [...SITE_CONFIG.clients]);

  readonly marqueeOffsetPx = signal(0);
  readonly marqueeTrackTransform = computed(() => `translate3d(${this.marqueeOffsetPx()}px, 0, 0)`);

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);

  readonly comparePosition = signal(52);
  private readonly compareDragging = signal(false);
  private readonly compareRoot = viewChild<ElementRef<HTMLElement>>('compareRoot');
  private readonly marqueeTrack = viewChild<ElementRef<HTMLElement>>('marqueeTrack');

  private readonly marqueeLoopWidth = signal(0);
  private readonly marqueeDragging = signal(false);
  private marqueeDragPointerId: number | null = null;
  private marqueeDragStartClientX = 0;
  private marqueeDragStartOffset = 0;
  private marqueeResizeObserver: ResizeObserver | undefined;
  private marqueeTickRaf = 0;
  private marqueeLastTickMs = 0;

  private readonly heroMedia = viewChild<ElementRef<HTMLElement>>('heroMedia');
  private readonly filmSection = viewChild<ElementRef<HTMLElement>>('filmSection');
  private readonly makeVideoEl = viewChild<ElementRef<HTMLVideoElement>>('makeVideo');
  private readonly doneVideoEl = viewChild<ElementRef<HTMLVideoElement>>('doneVideo');
  private readonly lottieBackTop = viewChild<ElementRef<HTMLElement>>('lottieBackTop');
  private filmVideoObserver: IntersectionObserver | undefined;

  readonly showMakeVideo = computed(() => !!SITE_CONFIG.media.videoMake?.trim());
  readonly showDoneVideo = computed(() => !!SITE_CONFIG.media.videoDone?.trim());
  readonly hasLocalVideos = computed(() => this.showMakeVideo() || this.showDoneVideo());

  readonly backToTopFx = signal(false);
  private backToTopFxTimer: ReturnType<typeof setTimeout> | undefined;
  private lottieInstance: AnimationItem | undefined;
  private scrollRafId = 0;

  constructor() {
    afterNextRender(() => {
      this.initScrollReveals(this.host.nativeElement);
      this.applyHeroParallax();
      this.initMarqueeScroll();
      this.initFilmVideos();
    });
    this.destroyRef.onDestroy(() => {
      if (this.scrollRafId !== 0) {
        cancelAnimationFrame(this.scrollRafId);
      }
      if (this.marqueeTickRaf !== 0) {
        cancelAnimationFrame(this.marqueeTickRaf);
        this.marqueeTickRaf = 0;
      }
      if (this.backToTopFxTimer !== undefined) {
        window.clearTimeout(this.backToTopFxTimer);
      }
      this.marqueeResizeObserver?.disconnect();
      this.marqueeResizeObserver = undefined;
      this.filmVideoObserver?.disconnect();
      this.filmVideoObserver = undefined;
      this.destroyLottie();
    });
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.scrolled.set(window.scrollY > 24);
    this.applyHeroParallax();
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  onComparePointerUp(): void {
    this.compareDragging.set(false);
  }

  @HostListener('window:pointermove', ['$event'])
  onComparePointerMove(event: PointerEvent): void {
    if (!this.compareDragging()) return;
    event.preventDefault();
    this.updateCompareFromClientX(event.clientX);
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  onComparePointerDown(event: PointerEvent): void {
    event.preventDefault();
    const host = event.currentTarget as HTMLElement;
    host.setPointerCapture(event.pointerId);
    this.compareDragging.set(true);
    this.updateCompareFromClientX(event.clientX);
  }

  onCompareShowBefore(event: Event): void {
    event.preventDefault();
    this.comparePosition.set(100);
  }

  onCompareShowAfter(event: Event): void {
    event.preventDefault();
    this.comparePosition.set(0);
  }

  onFilmVideoReady(event: Event): void {
    const v = event.target;
    if (v instanceof HTMLVideoElement) {
      this.primeFilmVideoFrame(v);
    }
  }

  lockVideoMuted(event: Event): void {
    const v = event.target;
    if (!(v instanceof HTMLVideoElement)) return;
    queueMicrotask(() => {
      v.muted = true;
      v.volume = 0;
      v.defaultMuted = true;
    });
  }

  onBackToTop(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.backToTopFxTimer !== undefined) {
      window.clearTimeout(this.backToTopFxTimer);
      this.backToTopFxTimer = undefined;
    }
    if (this.scrollRafId !== 0) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = 0;
    }

    const scrollMs = 1350;
    const overlayMs = 1580;

    this.backToTopFx.set(false);
    this.destroyLottie();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.backToTopFx.set(true);
        this.playBackToTopLottie(scrollMs / 1000);
        this.smoothScrollToTop(scrollMs);
        this.backToTopFxTimer = window.setTimeout(() => {
          history.replaceState(null, '', '#top');
          this.backToTopFx.set(false);
          this.destroyLottie();
          this.backToTopFxTimer = undefined;
        }, overlayMs);
      });
    });
  }

  private playBackToTopLottie(targetDurationSec: number): void {
    const container = this.lottieBackTop()?.nativeElement;
    if (!container) return;
    this.destroyLottie();
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData: cleaningYellowHand as unknown as Record<string, unknown>,
    });
    this.lottieInstance = anim;

    const syncSpeed = (): void => {
      const naturalSec = anim.getDuration(false);
      if (naturalSec > 0) {
        anim.setSpeed(naturalSec / targetDurationSec);
        anim.goToAndPlay(0, true);
      }
    };

    anim.addEventListener('DOMLoaded', syncSpeed);
    syncSpeed();
    queueMicrotask(syncSpeed);
    requestAnimationFrame(syncSpeed);
  }

  private destroyLottie(): void {
    if (this.lottieInstance) {
      try {
        this.lottieInstance.destroy();
      } catch {}
      this.lottieInstance = undefined;
    }
    const el = this.lottieBackTop()?.nativeElement;
    if (el) {
      el.replaceChildren();
    }
  }

  private scrollRootTop(): number {
    const se = document.scrollingElement ?? document.documentElement;
    return se.scrollTop;
  }

  private smoothScrollToTop(durationMs: number): void {
    const startY = this.scrollRootTop();
    if (startY <= 0) return;

    const t0 = performance.now();
    const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
    const se = document.scrollingElement ?? document.documentElement;

    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / durationMs);
      const y = startY * (1 - easeOut(t));
      window.scrollTo(0, y);
      se.scrollTop = y;
      if (document.body) document.body.scrollTop = y;
      if (t < 1) {
        this.scrollRafId = requestAnimationFrame(step);
      } else {
        this.scrollRafId = 0;
      }
    };

    this.scrollRafId = requestAnimationFrame(step);
  }

  private initFilmVideos(): void {
    const primeAll = (): void => {
      const make = this.makeVideoEl()?.nativeElement;
      const done = this.doneVideoEl()?.nativeElement;
      if (make) this.primeFilmVideoFrame(make);
      if (done) this.primeFilmVideoFrame(done);
    };

    queueMicrotask(primeAll);
    requestAnimationFrame(primeAll);

    const section = this.filmSection()?.nativeElement;
    if (!section || typeof IntersectionObserver === 'undefined') return;

    this.filmVideoObserver?.disconnect();
    this.filmVideoObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        primeAll();
      },
      { threshold: 0.12, rootMargin: '80px 0px' },
    );
    this.filmVideoObserver.observe(section);
  }

  /** Paint first frame on mobile (iOS often waits for user tap before loadeddata). */
  private primeFilmVideoFrame(video: HTMLVideoElement): void {
    if (video.dataset['framePrimed'] === '1') return;

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';

    const markPrimed = (): void => {
      video.dataset['framePrimed'] = '1';
      try {
        if (video.readyState >= 2 && video.currentTime < 0.01) {
          video.currentTime = 0.05;
        }
      } catch {
        /* ignore seek errors */
      }
    };

    const tryPlayPause = (): void => {
      const playAttempt = video.play();
      if (!playAttempt) {
        markPrimed();
        return;
      }
      playAttempt
        .then(() => {
          video.pause();
          markPrimed();
        })
        .catch(() => markPrimed());
    };

    if (video.readyState >= 2) {
      markPrimed();
      tryPlayPause();
    } else {
      video.load();
      video.addEventListener('loadeddata', () => tryPlayPause(), { once: true });
    }
  }

  private updateCompareFromClientX(clientX: number): void {
    const root = this.compareRoot()?.nativeElement;
    if (!root) return;
    const media = root.querySelector('.compare__media') as HTMLElement | null;
    const rect = (media ?? root).getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    this.comparePosition.set(Math.round((x / rect.width) * 100));
  }

  onMarqueePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const host = event.currentTarget as HTMLElement;
    this.marqueeDragPointerId = event.pointerId;
    this.marqueeDragStartClientX = event.clientX;
    this.marqueeDragStartOffset = this.marqueeOffsetPx();
    this.marqueeDragging.set(true);
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  }

  onMarqueePointerMove(event: PointerEvent): void {
    if (!this.marqueeDragging() || event.pointerId !== this.marqueeDragPointerId) return;
    const loopW = this.marqueeLoopWidth();
    if (loopW <= 0) return;
    event.preventDefault();
    const dx = event.clientX - this.marqueeDragStartClientX;
    this.marqueeOffsetPx.set(this.wrapMarqueeOffset(this.marqueeDragStartOffset + dx, loopW));
  }

  onMarqueePointerUp(event: PointerEvent): void {
    if (this.marqueeDragPointerId === null || event.pointerId !== this.marqueeDragPointerId) return;
    const host = event.currentTarget as HTMLElement;
    try {
      host.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    this.marqueeDragging.set(false);
    this.marqueeDragPointerId = null;
  }

  private wrapMarqueeOffset(offset: number, loopW: number): number {
    if (loopW <= 0) return offset;
    let o = offset;
    while (o <= -loopW) o += loopW;
    while (o > 0) o -= loopW;
    return o;
  }

  private initMarqueeScroll(): void {
    const trackEl = () => this.marqueeTrack()?.nativeElement;

    const measure = (): void => {
      const el = trackEl();
      if (!el || el.scrollWidth < 2) return;
      const w = el.scrollWidth / MARQUEE_SEGMENTS;
      if (w <= 0) return;
      this.marqueeLoopWidth.set(w);
      this.marqueeOffsetPx.update((o) => this.wrapMarqueeOffset(o, w));
    };

    requestAnimationFrame(() => requestAnimationFrame(measure));

    this.marqueeResizeObserver = new ResizeObserver(measure);
    queueMicrotask(() => {
      const el = trackEl();
      if (el) {
        this.marqueeResizeObserver?.observe(el);
      }
    });

    this.marqueeLastTickMs = performance.now();
    const tick = (now: number): void => {
      this.marqueeTickRaf = requestAnimationFrame(tick);
      const loopW = this.marqueeLoopWidth();
      if (loopW <= 0) {
        measure();
        return;
      }
      if (!this.marqueeDragging()) {
        const dtMs = now - this.marqueeLastTickMs;
        this.marqueeLastTickMs = now;
        const dt = Math.min(0.064, Math.max(0, dtMs / 1000));
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const speed = reduced ? 12 : 30;
        this.marqueeOffsetPx.update((o) => this.wrapMarqueeOffset(o - speed * dt, loopW));
      } else {
        this.marqueeLastTickMs = now;
      }
    };

    this.marqueeTickRaf = requestAnimationFrame(tick);
  }

  private applyHeroParallax(): void {
    const node = this.heroMedia()?.nativeElement;
    if (!node) return;
    const y = window.scrollY;
    node.style.transform = `translate3d(0, ${y * 0.18}px, 0) scale(1.05)`;
  }

  private initScrollReveals(root: HTMLElement): void {
    const nodes = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const cleanups: Array<() => void> = [];

    nodes.forEach((el) => {
      const delay = Number(el.dataset['revealDelay'] ?? 0);
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          window.setTimeout(() => el.classList.add('is-revealed'), delay);
          observer.disconnect();
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      );
      observer.observe(el);
      cleanups.push(() => observer.disconnect());
    });

    this.destroyRef.onDestroy(() => cleanups.forEach((fn) => fn()));
  }
}
