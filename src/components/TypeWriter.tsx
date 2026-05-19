import { useState, useEffect } from "react";

interface TypeWriterProps {
  words: string[];
  className?: string;
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseMs?: number;
}

export default function TypeWriter({
  words,
  className = "",
  typingSpeed = 100,
  deletingSpeed = 50,
  pauseMs = 2000,
}: TypeWriterProps) {
  const [text, setText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex];

    if (isPaused) {
      const pauseTimer = setTimeout(() => {
        setIsPaused(false);
        setIsDeleting(true);
      }, pauseMs);
      return () => clearTimeout(pauseTimer);
    }

    if (isDeleting) {
      if (text === "") {
        // Wrap in setTimeout to avoid synchronous setState in effect body
        const resetTimer = setTimeout(() => {
          setIsDeleting(false);
          setWordIndex((prev) => (prev + 1) % words.length);
        }, 0);
        return () => clearTimeout(resetTimer);
      }
      const deleteTimer = setTimeout(() => {
        setText((prev) => prev.slice(0, -1));
      }, deletingSpeed);
      return () => clearTimeout(deleteTimer);
    }

    if (text === currentWord) {
      // Wrap in setTimeout to avoid synchronous setState in effect body
      const doneTimer = setTimeout(() => {
        setIsPaused(true);
      }, 0);
      return () => clearTimeout(doneTimer);
    }

    const typeTimer = setTimeout(() => {
      setText(currentWord.slice(0, text.length + 1));
    }, typingSpeed);

    return () => clearTimeout(typeTimer);
  }, [text, wordIndex, isDeleting, isPaused, words, typingSpeed, deletingSpeed, pauseMs]);

  return (
    <span className={className}>
      {text}
      <span className="inline-block w-[3px] h-[1em] ml-1 bg-[#38BDF8] animate-pulse align-middle" />
    </span>
  );
}
