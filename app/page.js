import Image from 'next/image';

export default function Page() {
  return (
    <main>
      <h1>next/image abort hang repro</h1>
      <Image src="/hero.webp" alt="hero" width={2560} height={1440} sizes="100vw" priority />
    </main>
  );
}
