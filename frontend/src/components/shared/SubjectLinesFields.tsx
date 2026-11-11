/**
 * The card's subject lines as the place's curation dialog corrects them:
 * whom the place commemorates (#2144) and, where the card can carry the line,
 * what the work depicts (#2421). A subject stands on one line: moved, it leaves
 * its list and joins the other's end, so Garuda read as commemorated is listed
 * under *Depicts* instead. Both lists are the dialog's form values, sent whole.
 */
import { CommemoratesField, type CommemoratedSubjectValue, type SubjectLine } from './CommemoratesField';

type Lines = Record<SubjectLine, CommemoratedSubjectValue[]>;

/** The two lists once `subject` moves off the line `from`, never listed twice. */
export function moveBetweenLines(lines: Lines, from: SubjectLine, subject: CommemoratedSubjectValue): Lines {
  const to: SubjectLine = from === 'commemorates' ? 'depicts' : 'commemorates';
  const already = lines[to].some(listed => listed.item === subject.item);
  return {
    ...lines,
    [from]: lines[from].filter(listed => listed.item !== subject.item),
    [to]: already ? lines[to] : [...lines[to], subject],
  } as Lines;
}

/** One line's subjects as the detail read serves them, in the shape the edit sends. */
export function subjectValues(read: readonly { qid: string; label: string; article_url: string | null }[] | undefined): CommemoratedSubjectValue[] {
  return (read ?? []).map(subject => ({ item: subject.qid, label: subject.label, articleUrl: subject.article_url }));
}

export function SubjectLinesFields({ lines, errors, onChange, showsDepicts, disabled }: {
  lines: Lines;
  errors: Partial<Record<SubjectLine, string>>;
  onChange: (line: SubjectLine, subjects: CommemoratedSubjectValue[]) => void;
  /** Whether the card can carry the *Depicts* line, and so the dialog corrects it. */
  showsDepicts: boolean;
  disabled: boolean;
}) {
  const move = (from: SubjectLine, subject: CommemoratedSubjectValue) => {
    const moved = moveBetweenLines(lines, from, subject);
    onChange('commemorates', moved.commemorates);
    onChange('depicts', moved.depicts);
  };
  return (
    <>
      <CommemoratesField
        subjects={lines.commemorates}
        elsewhere={showsDepicts ? lines.depicts : []}
        onChange={subjects => onChange('commemorates', subjects)}
        onMove={showsDepicts ? subject => move('commemorates', subject) : undefined}
        error={errors.commemorates}
        disabled={disabled}
      />
      {showsDepicts && (
        <CommemoratesField
          line="depicts"
          subjects={lines.depicts}
          elsewhere={lines.commemorates}
          onChange={subjects => onChange('depicts', subjects)}
          onMove={subject => move('depicts', subject)}
          error={errors.depicts}
          disabled={disabled}
        />
      )}
    </>
  );
}
