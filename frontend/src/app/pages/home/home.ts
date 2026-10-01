import { Component } from '@angular/core';
import { AsciiGlobe } from '../../components/ascii-globe/ascii-globe';

@Component({
  imports: [AsciiGlobe],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {}
