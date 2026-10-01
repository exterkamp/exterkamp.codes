import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/** Longest note the backend accepts. */
export const MAX_NOTE_LENGTH = 140;

export interface Note {
  id: number;
  lat: number;
  lon: number;
  text: string;
  created_at: string;
}

export interface NewNote {
  lat: number;
  lon: number;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly http = inject(HttpClient);

  list(): Observable<Note[]> {
    return this.http.get<Note[]>('/api/notes');
  }

  add(note: NewNote): Observable<Note> {
    return this.http.post<Note>('/api/notes', note);
  }
}
