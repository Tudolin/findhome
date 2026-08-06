/**
 * FindHome — landing page behaviour.
 *
 * Sem dependência nenhuma, ~4kB. Quatro coisas:
 *   1. reveal na rolagem (IntersectionObserver)
 *   2. parallax das camadas de fundo
 *   3. tilt 3D do mockup conforme o mouse
 *   4. barra de progresso + estado "grudado" da nav
 *
 * Duas regras que valem para tudo aqui:
 *
 *   - `prefers-reduced-motion` é consultado de verdade. Quando está ligado,
 *     nenhum listener de scroll/mousemove é instalado — não basta a animação ser
 *     curta, ela não deve existir.
 *   - Toda leitura de posição acontece dentro de um `requestAnimationFrame`, e
 *     a escrita de estilo também. Ler `scrollY` e escrever `transform` no meio
 *     do handler de scroll força layout sincronizado a cada evento, o que é
 *     exatamente o que faz um parallax "travar".
 */

(() => {
  'use strict';

  const root = document.documentElement;

  // Marca que o JS está vivo. O CSS esconde os elementos de reveal só sob `.js`,
  // então sem JavaScript a página aparece inteira em vez de ficar em branco.
  root.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------------- */
  /* 1. Reveal                                                              */
  /* ---------------------------------------------------------------------- */

  const revealables = document.querySelectorAll('[data-reveal]');

  // O atraso em cascata vive numa custom property para o CSS calcular o
  // transition-delay; o HTML só declara a ordem.
  for (const el of revealables) {
    el.style.setProperty('--reveal-delay', el.dataset.revealDelay || '0');
  }

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    for (const el of revealables) el.classList.add('is-visible');
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          // Uma vez visível, sempre visível: reanimar ao rolar de volta para
          // cima é irritante e cara.
          observer.unobserve(entry.target);
        }
      },
      // Dispara um pouco antes de entrar na viewport, para o elemento já estar
      // no lugar quando o olho chega nele.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    for (const el of revealables) observer.observe(el);
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Flutuação dos cartões do mockup                                     */
  /* ---------------------------------------------------------------------- */

  for (const el of document.querySelectorAll('[data-float]')) {
    el.style.setProperty('--float-index', el.dataset.float || '0');
  }

  /* ---------------------------------------------------------------------- */
  /* 3. Scroll: parallax, progresso e nav                                   */
  /* ---------------------------------------------------------------------- */

  const nav = document.querySelector('[data-nav]');
  const layers = [...document.querySelectorAll('[data-parallax]')].map((el) => ({
    el,
    // Fator de profundidade: 0 = parado, 1 = anda junto com a rolagem.
    depth: Number.parseFloat(el.dataset.parallax) || 0.1,
  }));

  let ticking = false;

  function onFrame() {
    ticking = false;

    const y = window.scrollY;

    // Progresso 0..1. `max(1, …)` evita divisão por zero numa página que caiba
    // inteira na tela.
    const scrollable = Math.max(1, root.scrollHeight - window.innerHeight);
    root.style.setProperty('--scroll', String(Math.min(1, y / scrollable)));

    if (nav) nav.dataset.stuck = y > 24 ? 'true' : 'false';

    if (!reduceMotion.matches) {
      for (const { el, depth } of layers) {
        // translate3d para a composição ficar na GPU. Um `top` animado
        // recalcularia layout a cada frame.
        el.style.transform = `translate3d(0, ${(y * depth).toFixed(2)}px, 0)`;
      }
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onFrame);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onFrame();

  /* ---------------------------------------------------------------------- */
  /* 4. Tilt 3D do mockup                                                   */
  /* ---------------------------------------------------------------------- */

  const stage = document.querySelector('[data-tilt]');

  // Só em ponteiro fino: num touchscreen não existe hover, e num tablet o
  // handler ficaria pendurado sem nunca disparar.
  if (stage && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const MAX_DEG = 7;
    let tiltPending = false;
    let pointer = { x: 0, y: 0 };

    function applyTilt() {
      tiltPending = false;
      if (reduceMotion.matches) return;
      stage.style.setProperty('--tilt-y', `${(pointer.x * MAX_DEG).toFixed(2)}deg`);
      stage.style.setProperty('--tilt-x', `${(-pointer.y * MAX_DEG).toFixed(2)}deg`);
    }

    // Ouvido no window, não no próprio mockup: seguir o mouse pela seção
    // inteira faz o objeto parecer estar no espaço, em vez de reagir só quando
    // o cursor cai exatamente em cima dele.
    window.addEventListener(
      'pointermove',
      (event) => {
        const box = stage.getBoundingClientRect();
        // -1..1 a partir do centro do elemento, saturado para o efeito não
        // explodir quando o cursor está longe.
        const cx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
        const cy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
        pointer = {
          x: Math.max(-1, Math.min(1, cx)),
          y: Math.max(-1, Math.min(1, cy)),
        };

        if (tiltPending) return;
        tiltPending = true;
        requestAnimationFrame(applyTilt);
      },
      { passive: true },
    );

    // Volta ao repouso quando o cursor sai da janela, senão o mockup fica
    // torto para sempre.
    document.addEventListener('pointerleave', () => {
      stage.style.removeProperty('--tilt-x');
      stage.style.removeProperty('--tilt-y');
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 5. CTAs                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Esta é uma landing de MVP: não existe checkout nem cadastro atrás dela
   * ainda. Um `href="#"` que não faz nada parece bug, então cada CTA diz o que
   * está acontecendo.
   *
   * Para ligar de verdade, troque este bloco pelo destino real — por exemplo
   * `<a href="https://app.seudominio.com/register">` no HTML — e apague o
   * handler. Nada mais depende dele.
   */
  for (const cta of document.querySelectorAll('[data-cta]')) {
    cta.addEventListener('click', (event) => {
      event.preventDefault();
      const plan = cta.dataset.cta === 'premium' ? 'Premium' : 'Free';
      window.alert(
        `Demonstração: o cadastro do plano ${plan} ainda não está ligado nesta página.\n\n` +
          'Para ativar, aponte este botão para a URL do app (veja landing/README.md).',
      );
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 6. Ano no rodapé, se algum dia houver um                               */
  /* ---------------------------------------------------------------------- */

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
