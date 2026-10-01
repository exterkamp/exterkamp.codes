import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AsciiGlobe } from './components/ascii-globe/ascii-globe';

@Component({
  imports: [RouterOutlet, AsciiGlobe],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
