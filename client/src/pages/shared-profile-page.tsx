import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Briefcase, FileText, GraduationCap, Code, Award, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PublicProfile {
  name?: string | null;
  email?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  cvUrl?: string | null;
  education: Array<{ id: string; degree: string; university: string; duration: string }>;
  projects: Array<{ id: string; name: string; description: string; link: string; duration: string }>;
  skills: Array<{ id: string; name: string; proficiency: string }>;
  experiences: Array<{ id: string; role: string; company: string; duration: string; description: string }>;
}

/** Public, read-only profile page: /profile/share/:slug (no login, no credits). */
export default function SharedProfilePage() {
  const [, params] = useRoute("/profile/share/:slug");
  const slug = params?.slug ?? "";

  const { data: profile, isLoading, isError } = useQuery<PublicProfile>({
    queryKey: [`/api/profile/share/${slug}`],
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
        <h1 className="text-2xl font-bold text-gray-900">Profile not found</h1>
        <p className="text-gray-600">This link may be wrong or the profile may no longer be shared.</p>
        <Link href="/"><Button>Go to Canar</Button></Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardContent className="p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="h-28 w-28 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center shrink-0">
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.name ?? "Profile photo"} className="h-28 w-28 object-cover" />
              ) : (
                <Briefcase className="h-10 w-10 text-gray-400" />
              )}
            </div>
            <div className="text-center sm:text-left">
              <h1 className="text-3xl font-bold text-gray-900">{profile.name || "Unnamed professional"}</h1>
              {profile.email && <p className="text-gray-600 mt-1">{profile.email}</p>}
              {profile.bio && <p className="text-gray-700 mt-4 whitespace-pre-line">{profile.bio}</p>}
              {profile.cvUrl && (
                <a href={profile.cvUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="mt-4"><FileText className="h-4 w-4 mr-2" />Download CV</Button>
                </a>
              )}
            </div>
          </CardContent>
        </Card>

        {profile.experiences.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5" />Experience</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {profile.experiences.map((x) => (
                <div key={x.id}>
                  <p className="font-semibold text-gray-900">{x.role} · {x.company}</p>
                  <p className="text-sm text-gray-500">{x.duration}</p>
                  {x.description && <p className="text-gray-700 mt-1 whitespace-pre-line">{x.description}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {profile.education.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5" />Education</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {profile.education.map((x) => (
                <div key={x.id}>
                  <p className="font-semibold text-gray-900">{x.degree}</p>
                  <p className="text-gray-700">{x.university}</p>
                  <p className="text-sm text-gray-500">{x.duration}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {profile.projects.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Code className="h-5 w-5" />Projects</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {profile.projects.map((x) => (
                <div key={x.id}>
                  <p className="font-semibold text-gray-900">{x.name}</p>
                  <p className="text-sm text-gray-500">{x.duration}</p>
                  {x.description && <p className="text-gray-700 mt-1 whitespace-pre-line">{x.description}</p>}
                  {x.link && /^https?:\/\//i.test(x.link) && (
                    <a href={x.link} target="_blank" rel="noreferrer noopener" className="text-primary text-sm inline-flex items-center gap-1 mt-1 hover:underline">
                      <ExternalLink className="h-3 w-3" />{x.link}
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {profile.skills.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Award className="h-5 w-5" />Skills</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {profile.skills.map((x) => (
                <Badge key={x.id} variant="secondary">{x.name} · {x.proficiency}</Badge>
              ))}
            </CardContent>
          </Card>
        )}

        <p className="text-center text-sm text-gray-500">Built with <Link href="/" className="text-primary hover:underline">Canar</Link></p>
      </div>
    </div>
  );
}
