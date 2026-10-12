/** Accounts currently have no uploaded avatar; the monogram follows the public nickname. */
export function ArtworkAuthor({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        role="img"
        aria-label={`${name}的文字头像`}
        className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d7ccbb] bg-[#eae2d4] font-serif text-lg text-[#68553e]"
      >
        {Array.from(name)[0]}
      </span>
      <span className="break-all text-sm">{name}</span>
    </div>
  );
}
