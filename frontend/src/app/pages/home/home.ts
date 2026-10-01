import { Component } from '@angular/core';
import { HandDrawnButton } from '../../components/hand-drawn-button/hand-drawn-button';

@Component({
  imports: [HandDrawnButton],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {}
