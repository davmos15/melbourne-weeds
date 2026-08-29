/**
 * Gallery + lightbox island (SPEC §8).
 *
 * The track is native CSS scroll snap. Nothing here implements dragging:
 * native scrolling gives correct momentum, rubber-banding and accessibility
 * on iOS and Android for free, and a hand-rolled pointer drag loses that
 * fight on a phone. This file only observes the scroll position, drives the
 * dots and counter, and decides whether a pointer gesture was a tap or a swipe.
 *
 * The "Copy link" button on the listing page rides along here rather than
 * becoming a third island — it is ten lines, on the same page, in the same
 * already-loaded bundle.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scrollBehavior = (): ScrollBehavior => (reduceMotion.matches ? 'auto' : 'smooth');

/** Pointer travel beyond this many pixels means the gesture was a swipe. */
const TAP_SLOP = 9;

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Frame {
  full: string;
  w: number;
  h: number;
  alt: string;
  blur: string;
}

/* ---------------------------------------------------------------- lightbox */

class Lightbox {
  private el: HTMLElement | null = null;
  private track: HTMLElement | null = null;
  private counter: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private frames: Frame[] = [];
  private label = '';

  private build(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.hidden = true;
    el.innerHTML = `
      <div class="lightbox-head">
        <button type="button" class="icon-button" data-close aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <span class="lightbox-caption" data-caption></span>
        <span class="gallery-counter" data-counter></span>
      </div>
      <div class="lightbox-track" data-track tabindex="0"></div>
      <div class="lightbox-foot">
        <button type="button" class="icon-button" data-prev aria-label="Previous photograph">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4L6.5 10l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="icon-button" data-next aria-label="Next photograph">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 4l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`;
    document.body.append(el);

    this.track = el.querySelector('[data-track]');
    this.counter = el.querySelector('[data-counter]');
    this.caption = el.querySelector('[data-caption]');

    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelector('[data-prev]')?.addEventListener('click', () => this.step(-1));
    el.querySelector('[data-next]')?.addEventListener('click', () => this.step(1));

    // A click on the backdrop — the padding around the contained image — closes.
    el.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('img, button')) return;
      if (target.closest('.lightbox-track, .lightbox-frame') || target === el) this.close();
    });

    this.track?.addEventListener('scroll', () => this.sync(), { passive: true });

    el.addEventListener('keydown', (event) => this.onKeydown(event));
    return el;
  }

  open(frames: Frame[], index: number, label: string, returnFocus: HTMLElement): void {
    this.frames = frames;
    this.label = label;
    this.returnFocus = returnFocus;
    this.el ??= this.build();
    this.el.setAttribute('aria-label', label);

    if (this.track) {
      this.track.innerHTML = frames
        .map(
          (f) =>
            `<div class="lightbox-frame"><img src="${f.full}" alt="${escapeAttr(f.alt)}" width="${f.w}" height="${f.h}" ${
              // Only the frame being opened is eager; the rest arrive as you swipe.
              'loading="lazy" decoding="async"'
            } /></div>`,
        )
        .join('');
      const eager = this.track.children[index]?.querySelector('img');
      eager?.setAttribute('loading', 'eager');
    }

    this.el.hidden = false;
    document.body.classList.add('is-locked');
    this.goTo(index, 'auto');
    this.sync();
    (this.el.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (!this.el || this.el.hidden) return;
    this.el.hidden = true;
    document.body.classList.remove('is-locked');
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  private get index(): number {
    if (!this.track || !this.track.clientWidth) return 0;
    return Math.round(this.track.scrollLeft / this.track.clientWidth);
  }

  private goTo(index: number, behavior: ScrollBehavior = scrollBehavior()): void {
    if (!this.track) return;
    this.track.scrollTo({ left: index * this.track.clientWidth, behavior });
  }

  private step(delta: number): void {
    const next = Math.min(this.frames.length - 1, Math.max(0, this.index + delta));
    this.goTo(next);
  }

  private sync(): void {
    const i = this.index;
    if (this.counter) this.counter.textContent = `${i + 1} / ${this.frames.length}`;
    if (this.caption) this.caption.textContent = this.frames[i]?.alt ?? this.label;
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowRight') { event.preventDefault(); this.step(1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.step(-1); return; }
    if (event.key !== 'Tab' || !this.el) return;

    // Trap focus inside the overlay (SPEC §12).
    const items = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const lightbox = new Lightbox();

/* ----------------------------------------------------------- inline gallery */

function initGallery(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-track]');
  if (!track) return;

  const slides = [...track.querySelectorAll<HTMLElement>('.gallery-frame')];
  const dots = [...root.querySelectorAll<HTMLButtonElement>('[data-dot]')];
  const counter = root.querySelector<HTMLElement>('[data-counter]');
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-next]');
  const label = root.getAttribute('aria-label') ?? 'Photographs';

  const frames: Frame[] = slides.map((slide) => ({
    full: slide.dataset.full ?? '',
    w: Number(slide.dataset.w ?? 1600),
    h: Number(slide.dataset.h ?? 1000),
    alt: slide.dataset.alt ?? '',
    blur: slide.dataset.blur ?? '',
  }));

  const indexOf = () =>
    track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0;

  let current = 0;

  const sync = () => {
    const i = Math.min(frames.length - 1, Math.max(0, indexOf()));
    if (i === current) return;
    current = i;
    if (counter) counter.textContent = `${i + 1} / ${frames.length}`;
    dots.forEach((dot, n) => dot.setAttribute('aria-current', String(n === i)));
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === frames.length - 1;
  };

  const goTo = (i: number) => {
    track.scrollTo({ left: i * track.clientWidth, behavior: scrollBehavior() });
  };

  // Debounced via rAF: scroll fires far more often than the dots need updating.
  let ticking = false;
  track.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        sync();
      });
    },
    { passive: true },
  );

  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
  prev?.addEventListener('click', () => goTo(Math.max(0, indexOf() - 1)));
  next?.addEventListener('click', () => goTo(Math.min(frames.length - 1, indexOf() + 1)));

  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(Math.min(frames.length - 1, indexOf() + 1)); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(Math.max(0, indexOf() - 1)); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      lightbox.open(frames, indexOf(), label, track);
    }
  });

  /*
   * Tap versus swipe. A touch that scrolls the track must not also open the
   * lightbox, so `moved` is set both by pointer travel past the slop and by
   * pointercancel — which is what fires when the browser's own scrolling
   * takes the gesture over.
   */
  let startX = 0;
  let startY = 0;
  let moved = false;
  let tracking = false;

  track.addEventListener('pointerdown', (event) => {
    tracking = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
  });

  track.addEventListener('pointermove', (event) => {
    if (!tracking || moved) return;
    if (Math.abs(event.clientX - startX) > TAP_SLOP || Math.abs(event.clientY - startY) > TAP_SLOP) {
      moved = true;
    }
  });

  track.addEventListener('pointercancel', () => {
    moved = true;
    tracking = false;
  });

  track.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;
    if (moved) return;
    if ((event.target as HTMLElement).closest('button')) return;
    lightbox.open(frames, indexOf(), label, track);
  });

  // Fade each photograph in only once it has actually decoded, so a slow
  // image shows its blur placeholder rather than a grey hole.
  track.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if (img.complete) img.dataset.loaded = 'true';
    else img.addEventListener('load', () => { img.dataset.loaded = 'true'; }, { once: true });
  });

  sync();
  if (counter) counter.textContent = `1 / ${frames.length}`;
  if (prev) prev.disabled = true;
  if (next) next.disabled = frames.length <= 1;
}

document.querySelectorAll<HTMLElement>('[data-gallery]').forEach(initGallery);

/* --------------------------------------------------------------- copy link */

document.querySelectorAll<HTMLButtonElement>('[data-copy-link]').forEach((button) => {
  const original = button.querySelector('[data-copy-label]');
  button.hidden = false;
  button.addEventListener('click', async () => {
    const href = button.dataset.copyLink || location.href;
    try {
      await navigator.clipboard.writeText(href);
      button.dataset.copied = 'true';
      if (original) original.textContent = 'Copied';
      window.setTimeout(() => {
        delete button.dataset.copied;
        if (original) original.textContent = 'Copy link';
      }, 1800);
    } catch {
      // Clipboard blocked (insecure context, or the user said no). The slug
      // is displayed next to the button, so there is still a way to copy it.
      if (original) original.textContent = 'Press ⌘/Ctrl+C';
    }
  });
});
