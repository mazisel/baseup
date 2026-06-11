import Image from "next/image";

export function BrandLogo({ name, priority = false }: { name: string; priority?: boolean }) {
  return (
    <Image
      alt={name}
      className="brand-logo-image"
      height={346}
      priority={priority}
      sizes="(max-width: 700px) 128px, 164px"
      src="/baseup-logo.png"
      width={1050}
    />
  );
}
