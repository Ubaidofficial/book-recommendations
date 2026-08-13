/**
 * Author descriptions for published lists that have none.
 *
 * These 11 pages shipped with no description at all, so they fell back to a
 * generated line ("A curated collection of books in Philosophy.") that names
 * the subject and says nothing else. They are also, per keyword research, the
 * highest-opportunity pages on the site — best-philosophy-books alone sits on
 * a 9,100/month term at difficulty 2.
 *
 * Two rules the copy follows:
 *
 *   1. NO BOOK COUNTS. The stored text must stay true regardless of how many
 *      books a page displays, because how many it displays is about to change
 *      (list pages currently cap at ~48 while book_count claims thousands).
 *      Counts belong in the template, injected at render.
 *
 *   2. First sentence stands alone under 160 chars. clampDescription() cuts at
 *      a sentence boundary, so sentence one becomes the meta description
 *      intact and sentence two adds on-page depth.
 *
 * The semantically-related terms are the subject-adjacent nouns inside each
 * (ethics, metaphysics, existentialism), not repetitions of the head term —
 * that is the difference from the copy this replaces.
 *
 * Dry-run by default; --write persists and backs up prior values first.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ghpdpvatfmvsahzsqgpp.supabase.co";
const READ_KEY = "sb_publishable_bFeYm0jy_3SbxUkgl9_hjw_UH_MVF9Z";
const WRITE = process.argv.includes("--write");
const OUT = path.join(path.resolve(__dirname, ".."), "backups");

const DESCRIPTIONS = {
  "action-adventure": "Adventure fiction recommended most by novelists and readers who want momentum — survival at sea, exploration, heists and chase narratives. Plus the thrillers that hold up on a second read.",
  "adult": "Books for adult readers recommended across fiction and nonfiction — literary novels, memoir, history and ideas. Substantive reading chosen by people whose recommendations are worth following.",
  "american-history": "American history recommended most by historians, journalists and politicians — the founding, slavery and the Civil War, immigration and civil rights. Each title links back to who recommended it.",
  "architecture": "Architecture books recommended most by architects, planners and designers — building theory, architectural history and iconic structures. Plus the writing on how space shapes the people inside it.",
  "art": "Art books recommended most by artists, curators and critics — movements, monographs, technique and criticism. Chosen from real reading lists rather than gallery gift shops.",
  "best-architecture-books": "Architecture books recommended most by architects and urban planners — building theory, architectural history and iconic structures. Plus the writing on how space shapes the people inside it.",
  "best-art-books": "Art books recommended most by artists, curators and critics — monographs, movements and technique. Plus the art history that repays slow reading.",
  "best-art-history-books": "Art history recommended most by curators, critics and historians — movements, periods and the monographs that define them. Plus the survey works worth reading end to end.",
  "best-basketball-books": "Basketball books recommended most by players, coaches and sportswriters — biographies, dynasties and analytics. Plus the reporting behind the game's defining seasons.",
  "best-books-for-2-year-olds": "Picture books and board books recommended most for two-year-olds — read-aloud favourites, first words and bedtime rhyme. Drawn from parents, librarians and early-years educators rather than general reading lists.",
  "best-books-on-writing": "The books on writing that novelists and journalists recommend most — craft, structure, style and revision. Plus the working habits behind finished books.",
  "best-childrens-books": "Children's books recommended most by teachers, librarians and parents — picture books, early readers and chapter books. Including the classics that survive every generation.",
  "best-civil-war-books": "American Civil War books recommended most by historians — campaign narratives, biography, slavery and emancipation. Including the works that reframed how the war is understood.",
  "best-coffee-table-books": "Large-format books recommended for the ones that stay out on the table — photography, art, design and travel. Chosen for the printing as much as the subject.",
  "best-comic-books": "The comics and graphic novels creators and critics recommend most — superhero epics, literary graphic memoir and manga. Independent series included, each showing who recommended it.",
  "best-design-books": "Design books recommended most by working designers — typography, interaction, systems and craft. Including the classics that stay on studio shelves.",
  "best-dog-training-books": "Dog training books recommended most by trainers and behaviourists — positive reinforcement, puppy basics and reactivity. Plus the behavioural science underneath the methods.",
  "best-fashion-books": "Fashion books recommended most by designers, editors and historians — house monographs, fashion history and photography. Plus the criticism that takes clothing seriously.",
  "best-filmmaking-books": "Filmmaking books recommended most by directors, editors and cinematographers — screenwriting, directing and editing. Plus the production stories worth learning from.",
  "best-gardening-books": "Gardening books recommended most by growers and designers — planting, soil, pruning and kitchen gardens. Plus native planting and the reference works worth shelf space.",
  "best-horror-books": "The horror novels writers and critics return to most — gothic classics, cosmic dread and folk horror. Haunted houses and modern literary horror too, each with the source behind the recommendation.",
  "best-leadership-books": "The leadership books founders, executives and military officers recommend most — management, decision-making and organisational culture. Ranked by how many people recommended each title, not by publisher marketing.",
  "best-lesbian-books": "Lesbian fiction and memoir recommended most by writers, critics and readers — love stories, literary novels and history. Including the classics passed hand to hand.",
  "best-marketing-books": "Marketing books recommended most by operators and founders — positioning, brand, copywriting and growth. Plus the pricing case studies that hold up.",
  "best-marriage-books": "Books on marriage recommended most by therapists and long-married couples — communication, conflict and intimacy. Plus the research behind what actually keeps partners together.",
  "best-math-books": "Mathematics books recommended most by mathematicians and teachers — number theory, proof and statistics. Plus the popular accounts that convey the ideas without diluting them.",
  "best-nutrition-books": "Nutrition books recommended most by dietitians, doctors and researchers — metabolism, whole foods and the evidence behind popular diets. From writers who read the studies properly.",
  "best-photography-books": "Photography books recommended most by working photographers and editors — monographs, technique and the history of the medium. Including the collections that changed how people see.",
  "best-physics-books": "Physics books recommended most by physicists and science writers — quantum mechanics, relativity and cosmology. Plus the popular accounts that keep the mathematics honest.",
  "best-poetry-books": "Poetry collections recommended most by poets, critics and readers who keep them within reach — modern verse, translated classics and anthologies. Each pick links back to who recommended it.",
  "best-pregnancy-books": "Pregnancy and birth books recommended most by midwives, doctors and parents — trimester by trimester, birth options and postpartum recovery. With the evidence behind the advice.",
  "best-productivity-books": "The productivity books people actually finish and apply — focus, habits, time management and attention. Ranked by how many people recommended each title, with the source behind every pick.",
  "best-sales-books": "The sales books that quota-carriers and founders actually recommend — prospecting, negotiation and pricing. Ranked by how many people recommended each title, not by publisher marketing.",
  "best-science-fiction-books": "Science fiction recommended most by novelists, scientists and technologists — space opera, cyberpunk and hard SF. Plus the dystopias that aged into documentaries, each with its original source.",
  "best-space-opera-books": "Space opera recommended most by science fiction writers and readers — galactic empires, generation ships and interstellar war. Plus the long-running series worth committing to.",
  "best-startup-books": "The startup books founders recommend most — lean methodology, venture funding, product-market fit and hiring. Plus the company histories worth reading before you repeat them.",
  "best-statistics-books": "Statistics books recommended most by analysts and researchers — inference, probability and experimental design. Plus the books that teach you to spot a bad chart.",
  "best-survival-books": "Survival books recommended by people who have tested the advice — wilderness skills, bushcraft and disaster preparedness. Plus first-hand accounts of getting out alive.",
  "best-time-travel-books": "Time travel fiction recommended most by writers and readers — paradoxes, alternate histories and quiet literary takes. Including the novels that treat the mechanics seriously.",
  "best-young-adult-books": "Young adult novels recommended most by teachers, librarians and YA writers — coming-of-age stories, fantasy and contemporary realism. Including the crossover books adults quietly read too.",
  "books-recommended-by-bill-gates": "Every book Bill Gates has recommended — on Gates Notes, in interviews and in his annual summer reading lists — with the source for each pick. Gates reads widely across global health, history, physics and business, and the list spans all of it.",
  "books-recommended-by-billionaires": "Books recommended by self-made billionaires — investing, business building, biography and the long-horizon thinking behind their decisions. Every pick names the person who recommended it and where.",
  "books-recommended-by-ceos": "Reading recommended by chief executives and senior operators — management, strategy, negotiation, organisational culture and the biographies they learn from. Each pick shows who recommended it.",
  "books-recommended-by-elon-musk": "The books Elon Musk has recommended in interviews, on stage and in his own posts — physics, rocketry, artificial intelligence and biography. Plus the science fiction he cites most, each linked to where he said it.",
  "books-recommended-by-founders": "The books startup founders recommend most — company building, product, hiring, fundraising and the histories of firms that got there first. Including picks from Paul Graham, Elon Musk and Peter Thiel.",
  "books-recommended-by-investors": "Books recommended by venture capitalists, hedge fund managers and angel investors — valuation, market history, risk and decision-making under uncertainty. Each with the source behind it.",
  "books-recommended-by-naval-ravikant": "The books Naval Ravikant recommends most — philosophy, wealth and leverage, decision-making, and the science and Stoicism he returns to. Gathered from his podcasts, essays and posts, each with a source.",
  "books-recommended-by-paul-graham": "Books recommended by Paul Graham, Y Combinator co-founder and essayist — startups, writing, history, and the thinkers behind his essays. Sourced from those essays, interviews and talks.",
  "books-recommended-by-ryan-holiday": "The books Ryan Holiday recommends most — Stoicism, biography, ancient history, and the reading behind his own writing. Drawn from his reading-list newsletter, podcasts and books, each with a source.",
  "books-recommended-by-tim-ferriss": "Books recommended by Tim Ferriss on his podcast, blog and in his own writing — performance, philosophy, investing, psychedelics and biography. Guest recommendations included, each traced to the episode or post.",
  "books-recommended-by-warren-buffett": "The books Warren Buffett recommends — value investing, accounting, business history and the shareholder letters he points readers to. Gathered from Berkshire meetings, letters and interviews.",
  "books-recommended-by-writers": "The books novelists, essayists and journalists recommend most — craft and style, the fiction they reread, and the reporting they measure their own work against.",
  "buddhism": "The Buddhist books teachers, writers and long-time practitioners recommend most — meditation, mindfulness, Zen and Tibetan Buddhism. Core texts included, each linking back to who recommended it.",
  "children-sfiction": "Children's fiction recommended most by teachers, librarians and parents — chapter books, middle grade novels and modern classics. The stories that turn reluctant readers into committed ones.",
  "comics-fiction": "Comics and graphic novels recommended most by creators and critics — literary graphic memoir, superhero epics and manga. Independent series included, each with its source.",
  "design": "Design books recommended most by working designers — typography, interaction design, systems and craft. Including the classics that stay on studio shelves for decades.",
  "environment": "Environment and nature books recommended most by scientists, activists and nature writers — climate, ecology and conservation. Plus the landscape writing that makes the science land.",
  "fantasy": "Fantasy recommended most by avid readers, authors and curators — epic secondary worlds, sword and sorcery and contemporary fantasy. Including the long series worth committing to.",
  "finance": "Finance books recommended most by investors, fund managers and entrepreneurs — valuation, markets, risk and personal finance. Plus the crash histories that explain the rules.",
  "food": "Food writing and cookbooks recommended most by chefs, writers and serious home cooks — technique, regional cooking and food history. Plus the memoirs worth reading for the prose alone.",
  "foodhobbies": "Cooking and hobby books recommended most by practitioners — technique, craft, regional cooking and the reference works people actually keep. Each pick shows who recommended it.",
  "health": "Health books recommended most by doctors, nutritionists and coaches — sleep, exercise, longevity and preventive medicine. From writers who read the studies rather than the headlines.",
  "historical-fiction": "Historical fiction recommended most by novelists and historians — war, empire, family sagas and the novels that send you to the history afterwards. With a source behind every pick.",
  "hobbies": "Books on hobbies and crafts recommended by practitioners — woodworking, cooking, making, collecting and the skills worth learning slowly. Chosen by people who do the thing.",
  "humor": "Funny books recommended most by comedians, essayists and readers — comic novels, satire, humorous memoir and the essays that survive rereading.",
  "leadership": "Leadership books most recommended by CEOs, executives and military officers — management, decision-making and organisational culture. Ranked by how many people recommended each title.",
  "lgbtq": "LGBTQ books recommended most by writers, critics and readers — literary fiction, memoir and history. Including the classics passed hand to hand before they were shelved openly.",
  "management": "Management books recommended most by operators and executives — hiring, feedback, organisational design and the day-to-day of running teams. Ranked by how many people recommended each title.",
  "mathscience": "Maths and science books recommended most by researchers and science writers — proof, probability, evolution and cosmology. Popular accounts that keep the underlying rigour intact.",
  "mental-health": "Mental health books recommended most by therapists, researchers and people who have been through it — anxiety, depression, trauma and recovery. Each pick links back to its source.",
  "mystery-crime": "Crime novels and mysteries recommended most by writers and lifelong readers — detective fiction, noir and locked-room puzzles. From cosy whodunnits to bleak Scandinavian procedurals, each pick shows who recommended it and where.",
  "nature": "Nature writing recommended most by naturalists, scientists and essayists — landscape, wildlife, ecology and the long walks that became books. Each linking back to who recommended it.",
  "parenting": "Parenting books most recommended by paediatricians, child psychologists and parents — sleep, discipline, attachment and adolescence. With the evidence behind the advice.",
  "philosophy": "The philosophy books writers, scientists and founders return to most — ethics, metaphysics, existentialism and Stoicism. Ancient Greeks included, each with the source behind the pick.",
  "photography": "Photography books recommended most by working photographers and editors — monographs, technique and the history of the medium. Including the collections that changed how people see.",
  "physics": "Physics books recommended most by physicists and science writers — quantum mechanics, relativity, cosmology and particle physics. Popular accounts that keep the mathematics honest.",
  "poetry": "Poetry recommended most by poets, critics and readers who keep collections within reach — modern verse, translated classics and anthologies worth owning.",
  "politics": "Politics books recommended most by politicians, journalists and political scientists — democracy, power, ideology and the reporting behind the headlines.",
  "programming": "Programming books recommended most by senior engineers, CTOs and software architects — algorithms, data structures and system design. Plus the clean-code classics developers actually keep on the desk.",
  "psychology": "Psychology books recommended most by clinicians, researchers and writers — cognitive bias, behavioural economics, memory and trauma. Including the studies behind the popular science.",
  "relationships-family": "Books on relationships and family recommended most by therapists and researchers — attachment, communication, parenting and repair after conflict. With the evidence behind the advice.",
  "romance": "The romance novels readers and writers recommend most — contemporary love stories, historical romance and slow burns. Chosen from real reading lists rather than category bestseller charts.",
  "romancefiction": "Romantic fiction recommended most by novelists, reviewers and devoted readers — love stories that earn their endings. Spanning contemporary, historical and literary registers, each title links back to whoever recommended it.",
  "science-fiction": "Science fiction recommended most by technologists, futurists and novelists — artificial intelligence, space exploration and dystopias. Plus the space opera and hard SF that aged into documentaries.",
  "sociology": "Sociology recommended most by researchers and writers — inequality, cities, institutions, race and class. Including the fieldwork that changed how the questions get asked.",
  "spirituality": "Books on spirituality recommended most by teachers and practitioners across traditions — contemplative practice, meaning and mortality. The texts people return to for decades.",
  "sports": "Sports books recommended most by athletes, coaches and sportswriters — biography, dynasties, analytics and the long-form reporting that outlives the season.",
  "technology": "Technology books most recommended by founders, engineers and investors — computing history, artificial intelligence and product craft. Plus the essays that shaped the industry.",
  "teen-young": "Books for teenagers recommended most by teachers, librarians and YA writers — coming-of-age novels, fantasy and contemporary realism. Including the crossover titles adults read too.",
  "teen-young-adult": "Young adult books most recommended by educators, librarians and YA authors — coming-of-age novels, fantasy and contemporary realism. Including the crossover titles adults read too.",
  "thriller-suspense": "Thrillers and suspense recommended most by crime writers and readers — espionage, psychological suspense and legal thrillers. Plus the ones that still work once you know the twist.",
  "travel": "Travel books recommended most by adventurers and travel writers — journeys on foot, place writing and dispatches from the road. The books that send you looking at flights.",
  "writing": "The books on writing that novelists and journalists recommend most — craft, structure, style and revision. Plus the working habits behind finished books.",
};

(async () => {
  const sb = createClient(SUPABASE_URL, READ_KEY);
  const slugs = Object.keys(DESCRIPTIONS);
  const { data: rows, error } = await sb
    .from("lists")
    .select("id,slug,title,description,index_status")
    .in("slug", slugs);
  if (error) throw new Error(error.message);

  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) console.log("WARNING slugs not found:", missing.join(", "));

  let willOverwrite = 0;
  for (const r of rows) {
    const next = DESCRIPTIONS[r.slug];
    const had = (r.description || "").trim();
    if (had) willOverwrite++;
    console.log(`\n── ${r.slug} [${r.index_status}]`);
    console.log(`   was: ${had ? JSON.stringify(had.slice(0, 70)) : "(empty)"}`);
    console.log(`   now: ${next.slice(0, 100)}…`);
    console.log(`   meta-desc slice: ${next.split(/(?<=\.)\s/)[0].length} chars`);
  }
  console.log(`\n${rows.length} rows; ${willOverwrite} replacing existing copy`);

  if (!WRITE) return console.log("\nDRY RUN — pass --write to persist.");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("--write requires SUPABASE_SECRET_KEY");
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `list_descriptions_pre_write_${new Date().toISOString().replace(/[:.]/g, "")}.json`);
  fs.writeFileSync(f, JSON.stringify(rows, null, 1));
  console.log("backup:", path.relative(process.cwd(), f));

  const admin = createClient(SUPABASE_URL, secret);
  let ok = 0;
  for (const r of rows) {
    const { error: e } = await admin.from("lists").update({ description: DESCRIPTIONS[r.slug] }).eq("id", r.id);
    if (e) console.log(`  FAILED ${r.slug}: ${e.message}`);
    else ok++;
  }
  console.log(`updated ${ok}/${rows.length}`);
})();
